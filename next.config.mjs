/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Prisma's generated client out of Next's server-bundle tracer; it
  // ships its own native binaries.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
