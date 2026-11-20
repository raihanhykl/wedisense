/** @type {import('next').NextConfig} */
const nextConfig = {
  // `@wedisense/shared` is consumed from source (see the `paths` mapping in
  // tsconfig.json), so Next has to compile it like app code.
  transpilePackages: ['@wedisense/shared'],
  webpack: (config) => {
    // The shared package uses Node ESM-style specifiers (`./types/index.js`)
    // that point at `.ts` sources. Type-only imports never hit the bundler,
    // but runtime imports (shared constants) do — teach webpack that a `.js`
    // specifier may resolve to its TypeScript source.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;

// /** @type {import('next').NextConfig} */
// const nextConfig = {
//   async rewrites() {
//     return [
//       {
//         source: '/api/:path*',
//         destination: 'http://localhost:4000/api/:path*',
//       },
//       {
//         source: '/uploads/:path*',
//         destination: 'http://localhost:4000/uploads/:path*',
//       },
//     ];
//   },
// };

// export default nextConfig;
