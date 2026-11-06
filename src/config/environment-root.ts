import * as fs from 'fs';
import * as path from 'path';

/**
 * Locate the directory that owns OpenWA's configuration files.
 *
 * Process managers can launch the compiled entrypoint with a working directory outside the
 * repository. In that case resolving `.env` from process.cwd() silently boots OpenWA with defaults
 * (including the default WhatsApp engine) and hides integration secrets such as BOT_SECRET.
 */
export function resolveEnvironmentRoot(
  cwd: string = process.cwd(),
  applicationRoot: string = path.resolve(__dirname, '..', '..'),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  const hasConfiguration = (root: string): boolean =>
    fs.existsSync(path.resolve(root, '.env')) || fs.existsSync(path.resolve(root, 'data', '.env.generated'));

  if (hasConfiguration(cwd)) return cwd;

  // Jest deliberately uses empty temporary working directories to test first-run behavior. Do not
  // let those tests discover and modify the developer's real project configuration.
  if (nodeEnv !== 'test' && path.resolve(applicationRoot) !== path.resolve(cwd) && hasConfiguration(applicationRoot)) {
    return applicationRoot;
  }

  return cwd;
}
