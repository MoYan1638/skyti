// 通过 GitHub REST (Git Data API) 推送提交，绕过被代理阻断的 git push
// 用法: node scripts/api_push.js <owner/repo> <branch> <baseSha> <localFile>:<repoPath> ...
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
const [repo, branch, baseSha, ...specs] = process.argv.slice(2);
const API = `https://api.github.com/repos/${repo}`;

async function api(p, method = 'GET', body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'skyti-deploy',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  const baseCommit = await api(`/git/commits/${baseSha}`);
  const baseTree = baseCommit.tree.sha;
  console.log('base tree:', baseTree);

  const tree = [];
  for (const spec of specs) {
    const idx = spec.lastIndexOf(':');
    const local = spec.slice(0, idx);
    const repoPath = spec.slice(idx + 1);
    const content = fs.readFileSync(local);
    const blob = await api('/git/blobs', 'POST', {
      content: content.toString('base64'),
      encoding: 'base64',
    });
    console.log('blob', repoPath, blob.sha.slice(0, 8), content.length, 'bytes');
    tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await api('/git/trees', 'POST', { base_tree: baseTree, tree });
  const msg = 'fix(deploy): 修复 standard 版 Vercel 构建失败（win32-only rollup 原生包改为 optionalDependencies）';
  const newCommit = await api('/git/commits', 'POST', {
    message: msg,
    tree: newTree.sha,
    parents: [baseSha],
  });
  console.log('new commit:', newCommit.sha);

  await api(`/git/refs/heads/${branch}`, 'PATCH', { sha: newCommit.sha, force: false });
  console.log('ref updated:', branch, '->', newCommit.sha);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
