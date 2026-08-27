declare const __PACKAGE_VERSION__: string | undefined;
/** Package version, injected at build time and appended to the request `User-Agent`. */
export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined'
    ? __PACKAGE_VERSION__
    : '0.0.0-test';
