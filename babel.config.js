module.exports = function (api) {
  api.cache(true)
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.EAS_BUILD_PROFILE === 'production'
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
          },
        },
      ],
      // Em production: remove console.log/info/debug do bundle (anti-RE).
      // Mantém warn/error pra ErrorBoundary continuar logando crashes.
      ...(isProd ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
      'react-native-reanimated/plugin',
    ],
  }
}
