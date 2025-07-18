import { exec } from "node:child_process";
import * as esbuild from "esbuild";

const isServe = process.argv.includes("--serve");

// Function to pack the ZIP file
function packZip() {
  exec("node .vscode/pack-zip.js", (err, stdout, stderr) => {
    if (err) {
      console.error("Error packing zip:", err);
      return;
    }
    console.log(stdout.trim());
  });
}

// Custom plugin to pack ZIP after build or rebuild
const zipPlugin = {
  name: "zip-plugin",
  setup(build) {
    build.onEnd(() => {
      packZip();
    });
  },
};

// Base build configuration
const buildConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  logLevel: "info",
  color: true,
  outdir: "dist",
  plugins: [zipPlugin],
};

// Main function to handle both serve and production builds
(async () => {
  if (isServe) {
    console.log("Starting development server...");

    // Watch and Serve Mode
    // @ts-ignore
    const ctx = await esbuild.context(buildConfig);

    await ctx.watch();
    const { host, port } = await ctx.serve({
      servedir: ".",
      port: 3000,
    });
  } else {
    console.log("Building for production...");
    // @ts-ignore
    await esbuild.build(buildConfig);
    console.log("Production build complete.");
  }
})();
