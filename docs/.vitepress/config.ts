import { defineConfig } from 'vitepress'

// RoleCall user-guide site scaffold (Todo 3 / C3).
//
// The nav bar mirrors the Ansible-style sections of the work plan, and every
// sidebar entry maps one-to-one onto an existing source page under
// docs/content/<section>/<page>.md. With srcDir set to 'content', those pages
// route cleanly as /<section>/<page>, while the site home lives at
// docs/content/index.md -> /.
export default defineConfig({
  title: 'RoleCall',
  description:
    'RoleCall - Bun-first config management & orchestration (an Ansible alternative). User guide.',
  srcDir: 'content',
  outDir: '.vitepress/dist',
  base: '/',
  cleanUrls: true,
  appearance: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo: { light: '/wordmark-light.svg', dark: '/wordmark-dark.svg' },
    logoLink: '/',

    nav: [
      { text: 'Guide', link: '/guide/install' },
      { text: 'Reference', link: '/reference/command-reference' },
      { text: 'Concepts', link: '/concepts/playbooks' },
      { text: 'Best Practices', link: '/best-practices/' },
      { text: 'Deployment', link: '/deployment/systemd' },
      { text: 'Contributing', link: '/contributing/' },
    ],

    sidebar: {
      '/guide/': [
        { text: 'Install', link: '/guide/install' },
        { text: 'Quickstart', link: '/guide/quickstart' },
        { text: 'First Playbook', link: '/guide/first-playbook' },
      ],
      '/reference/': [
        { text: 'Command Reference', link: '/reference/command-reference' },
        { text: 'Global Options', link: '/reference/global-options' },
        { text: 'Playbook Commands', link: '/reference/playbook-commands' },
        { text: 'Inventory Commands', link: '/reference/inventory-commands' },
        { text: 'Facts Commands', link: '/reference/facts-commands' },
        { text: 'Vars Commands', link: '/reference/vars-commands' },
        { text: 'Plugin Commands', link: '/reference/plugin-commands' },
        { text: 'Serve Command', link: '/reference/serve-command' },
        { text: 'Module Reference', link: '/reference/module-reference' },
        { text: 'Writing a Plugin', link: '/reference/writing-a-plugin' },
      ],
      '/concepts/': [
        { text: 'Playbooks', link: '/concepts/playbooks' },
        { text: 'Plays', link: '/concepts/plays' },
        { text: 'Tasks', link: '/concepts/tasks' },
        { text: 'Roles', link: '/concepts/roles' },
        { text: 'Project', link: '/concepts/project' },
        { text: 'Inventory', link: '/concepts/inventory' },
        { text: 'Modules', link: '/concepts/modules' },
        { text: 'Playbook operators', link: '/concepts/playbook-operators' },
        { text: 'Templates', link: '/concepts/templates' },
        { text: 'Shell idempotency', link: '/concepts/shell-idempotency' },
        { text: 'Alternate modules', link: '/concepts/alternate-modules' },
        { text: 'Idempotency', link: '/concepts/idempotency' },
        { text: 'Transport', link: '/concepts/transport' },
        { text: 'Facts', link: '/concepts/facts' },
        { text: 'Variables', link: '/concepts/variables' },
      ],
      '/best-practices/': [
        { text: 'Overview', link: '/best-practices/' },
        { text: 'Playbook Design', link: '/best-practices/playbook-design' },
        { text: 'Inventory Management', link: '/best-practices/inventory-management' },
        { text: 'Secrets', link: '/best-practices/secrets' },
      ],
      '/deployment/': [
        { text: 'systemd', link: '/deployment/systemd' },
        { text: 'Native Binaries', link: '/deployment/native-binaries' },
        { text: 'Windows Service', link: '/deployment/windows-service' },
      ],
      '/contributing/': [
        { text: 'Overview', link: '/contributing/' },
        { text: 'Development', link: '/contributing/development' },
        { text: 'Testing', link: '/contributing/testing' },
        { text: 'CI', link: '/contributing/ci' },
      ],
    },

    footer: {
      message: 'RoleCall user guide. Local static build only.',
      copyright: 'Released under the LICENSE bundled with the project.',
    },
  },
})
