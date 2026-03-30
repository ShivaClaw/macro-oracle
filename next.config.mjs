/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // WalletConnect modal uses browser-only APIs — silence the SSR warning
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), '@walletconnect/modal']
    }
    return config
  }
};

export default nextConfig;
