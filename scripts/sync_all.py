# -*- coding: utf-8 -*-
"""SkyTi 一键同步脚本：standard 为源端，同步引擎/样式/交互/题库到 demo、pro 并构建三端。
用法：python scripts/sync_all.py [--no-build]
"""
import json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # monorepo2
STD = os.path.join(ROOT, 'standard')
VERS = ['demo', 'pro']
DOMAINS = {'demo': 'skytidemo.moyan06.icu', 'pro': 'skytipro.moyan06.icu',
           'standard': 'skyti.moyan06.icu'}
OG_SUBS = {'demo': '15道题 · 快速版', 'pro': '52道题 · 全维度版', 'standard': '30道题 · 标准版'}
TITLES = {'demo': 'SkyTi · Demo版', 'pro': 'SkyTi · Pro版', 'standard': 'SkyTi · 标准版'}

SYNC_FILES = ['sampler.js', 'engine.js', 'main.js', 'chart.js', 'report.js', 'feedback.js']

def data_dir(v):
    b = os.path.join(ROOT, v)
    return os.path.join(b, 'data') if os.path.exists(os.path.join(b, 'data', 'config.json')) \
        else os.path.join(b, 'src', 'data')

def patch_index(v, base):
    h = open(os.path.join(base, 'index.html'), encoding='utf-8').read()
    dom = DOMAINS[v]
    # 1) og:image（demo/pro 可能连 og:type 都没有，统一插到 </head> 前）
    if 'og:image' not in h:
        og = (f'  <meta property="og:title" content="SkyTi 光遇人格测试 · {v.capitalize()}" />\n'
              f'  <meta property="og:description" content="MBTI已经过时，SkyTi来了。{OG_SUBS[v].split(" ·")[0]}测出你的天空灵魂。" />\n'
              f'  <meta property="og:type" content="website" />\n'
              f'  <meta property="og:image" content="https://{dom}/og-image.png" />\n'
              f'  <meta name="theme-color" content="#060c1a" />\n')
        h = h.replace('</head>', og + '</head>')
    # 2) 结果页：稀有度 + CP 区块
    if 'result-rarity' not in h:
        h = h.replace(
            '<div class="result-intro" id="result-intro"></div>\n        <div class="result-desc" id="result-desc"></div>',
            '<div class="result-intro" id="result-intro"></div>\n'
            '        <div class="result-rarity" id="result-rarity"></div>\n'
            '        <div class="result-desc" id="result-desc"></div>\n'
            '        <div class="result-cp" id="result-cp">\n'
            '          <div class="cp-item"><span class="cp-icon">🤝</span><span class="cp-label">牵手搭子</span><span class="cp-name" id="cp-name"></span><span class="cp-line" id="cp-line"></span></div>\n'
            '          <div class="cp-item rival"><span class="cp-icon">🚫</span><span class="cp-label">斗篷不合</span><span class="cp-name" id="rival-name"></span><span class="cp-line" id="rival-line"></span></div>\n'
            '        </div>')
    # 3) 结果页：好友评我按钮
    if 'btn-friend' not in h:
        h = h.replace('<button id="btn-restart" class="btn btn-secondary">',
                      '<button id="btn-friend" class="btn btn-secondary" style="display:none">💌 好友评我</button>\n          <button id="btn-restart" class="btn btn-secondary">')
    # 4) 首页：历史记录区
    if 'history-section' not in h:
        h = h.replace('<p class="intro-credit">',
                      '<div id="history-section" class="history-section" style="display:none">\n'
                      '          <div class="history-title">✨ 旅行记录</div>\n'
                      '          <div id="history-list"></div>\n'
                      '          <button id="btn-history-clear" class="history-clear">清空记录</button>\n'
                      '        </div>\n        <p class="intro-credit">')
    # 5) 好友横幅
    if 'friend-banner' not in h:
        h = h.replace('<div id="app">', '<div id="app">\n    <div id="friend-banner" class="friend-banner" style="display:none"></div>')
    # 6) PWA：manifest + 图标
    if 'rel="manifest"' not in h:
        h = h.replace('<link rel="icon" type="image/svg+xml" href="./favicon.svg" />',
                      '<link rel="icon" type="image/svg+xml" href="./favicon.svg" />\n'
                      '  <link rel="manifest" href="./manifest.json" />\n'
                      '  <link rel="apple-touch-icon" href="./icon-192.png" />')
    open(os.path.join(base, 'index.html'), 'w', encoding='utf-8').write(h)

def sync_version(v):
    base = os.path.join(ROOT, v)
    # JS 源码
    for f in SYNC_FILES:
        shutil.copy(os.path.join(STD, 'src', f), os.path.join(base, 'src', f))
    q = open(os.path.join(STD, 'src', 'quiz.js'), encoding='utf-8').read().replace("'../data/", "'./data/")
    open(os.path.join(base, 'src', 'quiz.js'), 'w', encoding='utf-8').write(q)
    # report.js / feedback.js 同样做 data 路径替换（demo/pro 的 data 在 src/data）
    for f in ('report.js', 'feedback.js'):
        src = open(os.path.join(STD, 'src', f), encoding='utf-8').read().replace("'../data/", "'./data/")
        open(os.path.join(base, 'src', f), 'w', encoding='utf-8').write(src)
    # 样式
    shutil.copy(os.path.join(STD, 'src', 'style.css'), os.path.join(base, 'src', 'style.css'))
    # 题库总库
    shutil.copy(os.path.join(STD, 'data', 'questions-pool.json'),
                os.path.join(data_dir(v), 'questions-pool.json'))
    # types.json（稀有度/CP 数据三端同构，直接同步）
    shutil.copy(os.path.join(STD, 'data', 'types.json'), os.path.join(data_dir(v), 'types.json'))
    # config：shareUrl + levelFractions + version + stats（三端共用同一套上报配置）
    std_cfg = json.load(open(os.path.join(STD, 'data', 'config.json'), encoding='utf-8'))
    cp = os.path.join(data_dir(v), 'config.json')
    c = json.load(open(cp, encoding='utf-8'))
    c['display']['shareUrl'] = DOMAINS[v]
    c['display']['version'] = v
    c['display']['disclaimer'] = std_cfg['display']['disclaimer']
    c['stats'] = std_cfg.get('stats', {"enabled": False})
    c['scoring'].pop('levelThresholds', None)
    c['scoring']['levelFractions'] = {"L": 0.3333, "H": 0.6667}
    json.dump(c, open(cp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    # 看板页 + 稀有度参考数据（public/ 会被 Vite 原样拷贝到 dist）
    pub = os.path.join(base, 'public')
    os.makedirs(os.path.join(pub, 'data'), exist_ok=True)
    shutil.copy(os.path.join(STD, 'public', 'stats.html'), os.path.join(pub, 'stats.html'))
    shutil.copy(os.path.join(STD, 'data', 'types.json'), os.path.join(pub, 'data', 'types.json'))
    # PWA 文件分发
    for f in ('manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'):
        src = os.path.join(STD, 'public', f)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(pub, f))
    # SEO：robots.txt + sitemap.xml（按各端域名生成）
    dom = DOMAINS[v]
    with open(os.path.join(pub, 'robots.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(f'User-agent: *\nAllow: /\nDisallow: /stats.html\n\nSitemap: https://{dom}/sitemap.xml\n')
    pages = [(f'https://{dom}/', '1.0', 'daily'), (f'https://{dom}/og-image.png', '0.3', 'monthly')]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, pri, freq in pages:
        sm.append(f'  <url><loc>{loc}</loc><changefreq>{freq}</changefreq><priority>{pri}</priority></url>')
    sm.append('</urlset>')
    with open(os.path.join(pub, 'sitemap.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(sm) + '\n')
    # index.html 补丁
    patch_index(v, base)
    # 清理无引用的乱码遗留 data/*.js
    dd = os.path.join(base, 'src', 'data')
    if os.path.isdir(dd):
        for f in os.listdir(dd):
            if f.endswith('.js'):
                os.remove(os.path.join(dd, f))
                print(f'  [{v}] 删除遗留 {f}')
    print(f'[{v}] 同步完成')

def build(v):
    base = os.path.join(ROOT, v)
    vite = os.path.join(base, 'node_modules', 'vite', 'bin', 'vite.js')
    r = subprocess.run(['node', vite, 'build'], cwd=base, capture_output=True, text=True, shell=True)
    ok = 'built in' in (r.stdout + r.stderr)
    print(f'[{v}] 构建{"✅" if ok else "❌"}')
    if not ok:
        print(r.stdout[-800:], r.stderr[-800:])
    return ok

if __name__ == '__main__':
    for v in VERS:
        sync_version(v)
    if '--no-build' not in sys.argv:
        ok = build('standard')
        for v in VERS:
            ok = build(v) and ok
        sys.exit(0 if ok else 1)
