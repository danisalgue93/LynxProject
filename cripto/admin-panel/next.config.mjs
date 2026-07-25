/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // The known Next.js Image Optimizer DoS advisory (via remotePatterns) is only
  // fixed in a major upgrade (15+). This panel uses no next/image at all, so the
  // optimizer is dead weight — disabling it makes the advisory's attack surface
  // definitively unreachable without a risky major bump on a money-moving panel.
  images: {
    unoptimized: true,
  },
  experimental: {
    serverBodySizeLimit: '64kb',
  },
};

export default nextConfig;
