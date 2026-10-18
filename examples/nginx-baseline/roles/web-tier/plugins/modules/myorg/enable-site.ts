import { resource } from "rolecall/modules";

export default resource({
  describe: (args: { site: string }) => ({ site: args.site }),
  converge: (args: { site: string }) => ({ changed: true, site: args.site }),
});
