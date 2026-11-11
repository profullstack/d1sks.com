// d1sks's own WebMCP tool, beside the @profullstack/webmcp embed (site_info,
// open_page, search_site and the form tools). Same JSON API as the CLI.

const tools = [
  {
    name: 'get_disk',
    description:
      'One OpenDisk listing on d1sks: price per GiB-month, free space, country, standing and its OpenServer record.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Disk id, as returned by search_site' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true },
    async execute({ id }) {
      const res = await fetch(`/api/v1/disks/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
  },
];

function register() {
  const api = globalThis.ProfullstackWebMCP;
  if (api?.supported) api.registerTools(tools);
}

if (globalThis.ProfullstackWebMCP?.unregisterAll) register();
else document.addEventListener('webmcp:ready', register, { once: true });
