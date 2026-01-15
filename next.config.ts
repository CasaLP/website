import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@triton-one/yellowstone-grpc",
    "helius-laserstream-linux-x64-gnu",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        {
          "@triton-one/yellowstone-grpc":
            "commonjs @triton-one/yellowstone-grpc",
        },
        {
          "helius-laserstream-linux-x64-gnu":
            "commonjs helius-laserstream-linux-x64-gnu",
        }
      );
    }
    config.module.rules.push({
      test: /\.node$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
