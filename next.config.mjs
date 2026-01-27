/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'oss-t.chuhaijiang.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
