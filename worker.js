// Stawear edge worker: per-page share previews (/p/<id>, /c/<category>) and a live sitemap.xml.
// Everything else is served straight from /public.
const SITE = 'https://stawear.co.ke';
const SB_URL = 'https://hxijjdhvkjhfjxllckip.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4aWpqZGh2a2poZmp4bGxja2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDY3NDgsImV4cCI6MjA4ODk4Mjc0OH0.1GgPoNTFCRxvwVGsbMYoOKRzmfdr3XIlJo4orQwR0J8';   // public "anon" key (the same one the shop already uses in the browser)
const CATS = {
  doboks: 'Doboks & Uniforms', belts: 'Belts', sparring: 'Sparring Gear', pads: 'Pads & Targets',
  apparel: 'Training Wear', bags: 'Bags & Carry', accessories: 'Accessories'
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function sb(path) {
  try {
    const r = await fetch(SB_URL + '/rest/v1/' + path, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

function setMeta(html, key, value) {
  const re = new RegExp('(<meta\\s+(?:property|name)="' + key.replace(/[:.]/g, '\\$&') + '"\\s+content=")[^"]*(")');
  return html.replace(re, (_, a, b) => a + esc(value) + b);
}

export function applyMeta(html, m) {
  let h = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(m.title) + '</title>');
  for (const k of ['og:title', 'twitter:title']) h = setMeta(h, k, m.title);
  for (const k of ['og:description', 'twitter:description', 'description']) h = setMeta(h, k, m.description);
  for (const k of ['og:image', 'og:image:secure_url', 'twitter:image']) h = setMeta(h, k, m.image);
  h = setMeta(h, 'og:url', m.url);
  if (m.type) h = setMeta(h, 'og:type', m.type);
  h = h.replace(/(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => a + esc(m.url) + b);
  if (m.image !== SITE + '/og-image.jpg') h = h.replace(/<meta property="og:image:(width|height|type)"[^>]*>/g, '');
  return h;
}

export function productMeta(p) {
  const img = p.image && /^https:\/\//.test(p.image) ? p.image : SITE + '/og-image.jpg';
  const price = 'Ksh ' + Number(p.price).toLocaleString('en-KE');
  return {
    title: p.name + ' — Stawear',
    description: clip(price + ' · ' + (p.description || 'Taekwondo & martial arts gear at Stawear. M-Pesa accepted, nationwide delivery.'), 200),
    image: img, url: SITE + '/p/' + p.id
  };
}

export function categoryMeta(slug, row) {
  const label = (row && row.name) || CATS[slug] || slug;
  const img = row && row.image && /^https:\/\//.test(row.image) ? row.image : SITE + '/og-image.jpg';
  return {
    title: label + ' — Stawear Taekwondo & Martial Arts Shop',
    description: 'Shop ' + label + ' at Stawear. Taekwondo and martial arts gear in Kenya. M-Pesa accepted, nationwide delivery.',
    image: img, url: SITE + '/c/' + slug
  };
}

export function storyMeta(s) {
  const img = s.cover_image && /^https:\/\//.test(s.cover_image) ? s.cover_image : SITE + '/og-image.jpg';
  return {
    title: s.title + ' — Stawear',
    description: clip(s.excerpt || s.body || 'Read this story on Stawear.', 200),
    image: img, url: SITE + '/s/' + s.slug, type: 'article'
  };
}

export function buildSitemap(products, cats, stories) {
  const urls = [SITE + '/'];
  const slugs = new Set(Object.keys(CATS)); (cats || []).forEach(c => c.slug && slugs.add(c.slug));
  slugs.forEach(s => urls.push(SITE + '/c/' + encodeURIComponent(s)));
  (products || []).forEach(p => urls.push(SITE + '/p/' + p.id));
  (stories || []).forEach(s => s.slug && urls.push(SITE + '/s/' + encodeURIComponent(s.slug)));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => '  <url><loc>' + esc(u) + '</loc></url>').join('\n') + '\n</urlset>\n';
}

async function pageHtml(req, env) {
  const r = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  return r.text();
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/sitemap.xml') {
      const [products, cats, stories] = await Promise.all([sb('products?select=id'), sb('categories?select=slug'), sb('stories?select=slug&published=eq.true')]);
      return new Response(buildSitemap(products, cats, stories), {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }
      });
    }
    const m = u.pathname.match(/^\/(p|c|s)\/([^/]+)\/?$/);
    if (m) {
      const html = await pageHtml(req, env);
      let meta = null;
      if (m[1] === 'p' && /^\d+$/.test(m[2])) {
        const rows = await sb('products?id=eq.' + m[2] + '&select=id,name,description,image,price&limit=1');
        if (rows && rows[0]) meta = productMeta(rows[0]);
      } else if (m[1] === 's') {
        const slug = decodeURIComponent(m[2]).toLowerCase().replace(/[^a-z0-9-]/g, '');
        const rows = slug && await sb('stories?slug=eq.' + slug + '&published=eq.true&select=title,slug,excerpt,body,cover_image&limit=1');
        if (rows && rows[0]) meta = storyMeta(rows[0]);
      } else if (m[1] === 'c') {
        const slug = decodeURIComponent(m[2]).toLowerCase().replace(/[^a-z0-9-]/g, '');
        const rows = await sb('categories?slug=eq.' + slug + '&select=name,image&limit=1');
        if (slug && (CATS[slug] || (rows && rows[0]))) meta = categoryMeta(slug, rows && rows[0]);
      }
      return new Response(meta ? applyMeta(html, meta) : html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
      });
    }
    return env.ASSETS.fetch(req);
  }
};
