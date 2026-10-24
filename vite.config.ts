import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), reactRouter()],
    // Resolve the tsconfig `paths` aliases (`~/*`, `cva.config`) natively.
    resolve: { tsconfigPaths: true },
    optimizeDeps: {
        // Pre-bundle everything the client graph reaches so the dev server
        // never discovers a dependency mid-session. Late discovery
        // re-optimizes with a new hash and full-reloads the page, which can
        // leave two React copies in one module graph ("Invalid hook call"
        // crashes in Turnstile/FieldControl during dev and E2E runs).
        include: [
            'react',
            'react-dom',
            'react-hook-form',
            '@hookform/resolvers/zod',
            'better-auth/client',
            'better-auth/client/plugins',
            'class-variance-authority',
            'cva/config',
            'clsx',
            'tailwind-merge',
            'lucide-react',
            '@ai-sdk/react',
            'ai',
            'react-markdown',
            'zod',
            'tiny-invariant',
            '@sethdavis512/trellis',
            '@dnd-kit/core',
            '@dnd-kit/sortable',
            '@dnd-kit/utilities',
            '@portabletext/react',
            'minisearch',
            'perfect-freehand',
            'react-resizable-panels',
            '@portabletext/editor',
            '@portabletext/editor/behaviors',
            '@portabletext/editor/plugins',
            '@portabletext/editor/selectors',
            '@portabletext/plugin-markdown-shortcuts',
            '@portabletext/plugin-typeahead-picker',
            '@tanstack/charts',
            '@tanstack/charts/react',
            '@tanstack/charts/scales/band',
            '@tanstack/charts/scales/linear',
            '@tanstack/charts/scales/point',
            '@tanstack/charts/tooltip',
            '@base-ui/react/alert-dialog',
            '@base-ui/react/autocomplete',
            '@base-ui/react/collapsible',
            '@base-ui/react/context-menu',
            '@base-ui/react/dialog',
            '@base-ui/react/field',
            '@base-ui/react/fieldset',
            '@base-ui/react/input',
            '@base-ui/react/menu',
            '@base-ui/react/merge-props',
            '@base-ui/react/scroll-area',
            '@base-ui/react/select',
            '@base-ui/react/separator',
            '@base-ui/react/toast',
            '@base-ui/react/use-render',
            // Server-only packages. The browser never loads these, but the
            // dev server still registers them with the client optimizer
            // after the first authenticated SSR (seen with DEBUG=vite:deps),
            // so leaving them out re-optimizes and reloads open pages.
            '@prisma/adapter-pg',
            '@prisma/client/runtime/client',
            '@react-email/components',
            '@react-email/render',
            '@mastra/ai-sdk',
            '@mastra/core/agent',
            '@mastra/core/tools',
            '@mastra/memory',
            '@mastra/pg',
            'better-auth',
            'better-auth/adapters/prisma',
            'better-auth/plugins',
            'better-auth/plugins/admin/access',
            'resend',
            '@modelcontextprotocol/sdk/server/mcp.js',
            '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js',
        ],
    },
});
