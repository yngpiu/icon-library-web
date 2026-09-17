import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

try {
  console.log('1. Building project...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

  console.log('2. Getting git remote URL...');
  const remoteUrl = execSync('git remote get-url origin', { cwd: rootDir, encoding: 'utf-8' }).trim();
  console.log(`Remote: ${remoteUrl}`);

  // Clean existing .git in dist if any
  const distGit = path.join(distDir, '.git');
  if (existsSync(distGit)) {
    rmSync(distGit, { recursive: true, force: true });
  }

  console.log('3. Initializing git in dist...');
  execSync('git init -b gh-pages', { cwd: distDir, stdio: 'inherit' });
  execSync(`git remote add origin "${remoteUrl}"`, { cwd: distDir, stdio: 'inherit' });
  execSync('git add -A', { cwd: distDir, stdio: 'inherit' });
  execSync('git commit -m "Deploy to GitHub Pages"', { cwd: distDir, stdio: 'inherit' });

  console.log('4. Pushing to gh-pages branch on GitHub...');
  execSync('git push -f origin gh-pages', { cwd: distDir, stdio: 'inherit' });

  // Cleanup .git inside dist
  rmSync(distGit, { recursive: true, force: true });

  console.log('\n✅ Successfully deployed to GitHub Pages (gh-pages branch)!');
} catch (err) {
  console.error('\n❌ Deployment failed:', err.message);
  process.exit(1);
}
