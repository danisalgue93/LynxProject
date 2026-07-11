/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    serverBodySizeLimit: '64kb',
  },
};

export default nextConfig;
