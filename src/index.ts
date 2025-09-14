#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Используем require для Content API пока
const GhostContentAPI = require('@tryghost/content-api');

// Инициализация Ghost Content API
const api = new GhostContentAPI({
  url: process.env.GHOST_API_URL,
  key: process.env.GHOST_CONTENT_API_KEY, // Изменено на CONTENT key
  version: process.env.GHOST_API_VERSION || 'v5.0'
});

const server = new Server(
  {
    name: 'ghost-mcp-readonly',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Список доступных инструментов
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'search_posts',
        description: 'Search published posts from Ghost blog',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of posts (default: 10)' },
            filter: { type: 'string', description: 'Ghost filter syntax, e.g. "tag:news"' },
            fields: { type: 'string', description: 'Comma-separated fields to include' }
          }
        }
      },
      {
        name: 'get_post_by_slug',
        description: 'Get a specific post by its slug',
        inputSchema: {
          type: 'object',
          properties: {
            slug: { type: 'string', description: 'Post slug' }
          },
          required: ['slug']
        }
      },
      {
        name: 'search_by_content',
        description: 'Search posts by content/text',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_all_tags',
        description: 'Get all tags from the blog',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Обработчик вызовов инструментов
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_posts': {
        const posts = await api.posts.browse({
          limit: args.limit || 10,
          filter: args.filter,
          include: 'tags,authors',
          fields: args.fields || 'id,title,slug,excerpt,published_at,html,plaintext'
        });

        const formatted = posts.map(post => ({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          published: post.published_at,
          url: `${process.env.GHOST_API_URL}/${post.slug}/`,
          tags: post.tags?.map(t => t.name).join(', ')
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(formatted, null, 2)
          }]
        };
      }

      case 'get_post_by_slug': {
        const post = await api.posts.read(
          { slug: args.slug },
          { include: 'tags,authors', formats: ['html', 'plaintext'] }
        );

        return {
          content: [{
            type: 'text',
            text: `# ${post.title}\n\nURL: ${process.env.GHOST_API_URL}/${post.slug}/\nPublished: ${post.published_at}\nTags: ${post.tags?.map(t => t.name).join(', ')}\n\n---\n\n${post.plaintext}`
          }]
        };
      }

      case 'search_by_content': {
        const allPosts = await api.posts.browse({
          limit: 'all',
          formats: ['plaintext'],
          include: 'tags'
        });

        const query = args.query.toLowerCase();
        const filtered = allPosts.filter(post => 
          post.plaintext?.toLowerCase().includes(query) ||
          post.title?.toLowerCase().includes(query) ||
          post.excerpt?.toLowerCase().includes(query)
        );

        const results = filtered.slice(0, args.limit || 10).map(post => ({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt?.substring(0, 200) + '...',
          matchedContent: post.plaintext?.substring(
            Math.max(0, post.plaintext.toLowerCase().indexOf(query) - 50),
            post.plaintext.toLowerCase().indexOf(query) + query.length + 100
          )
        }));

        return {
          content: [{
            type: 'text',
            text: results.length > 0 
              ? JSON.stringify(results, null, 2)
              : 'No posts found matching your query'
          }]
        };
      }

      case 'get_all_tags': {
        const tags = await api.tags.browse({ limit: 'all' });
        const formatted = tags.map(tag => ({
          name: tag.name,
          slug: tag.slug,
          description: tag.description,
          count: tag.count?.posts
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(formatted, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Запуск сервера
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Ghost Content API MCP Server running (read-only mode)');
}

main().catch(console.error);
