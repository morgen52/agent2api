"""ORBIT private learning endpoint.

Only code is public. Personal card payload and capability are supplied as Render
service environment variables, never committed. No raw source code or chat logs.
"""
from __future__ import annotations

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import hashlib
import json
import re
import os
from urllib.parse import urlsplit

PORT = int(os.getenv("PORT", "8766"))
TOKEN = os.getenv("ORBIT_ACCESS_TOKEN", "")
PAYLOAD = os.getenv("ORBIT_PRIVATE_CARDS_B64", "")
if not TOKEN or len(TOKEN) < 40 or not PAYLOAD:
    raise SystemExit("Missing secure access token or private card payload")
try:
    PRIVATE_CARDS = base64.b64decode(PAYLOAD, validate=True)
    obj = json.loads(PRIVATE_CARDS)
    if obj.get("privacy") != "private-library-only" or not obj.get("cards"):
        raise ValueError("private manifest invalid")
except (ValueError, KeyError) as exc:
    raise SystemExit("Invalid private card payload") from exc

HTML = r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>ORBIT · 我的研究知识流</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#081716;color:#e5f7ee;font:15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}header{position:sticky;top:0;z-index:5;background:#081716e9;padding:14px 18px;border-bottom:1px solid #295347;display:flex;justify-content:space-between;align-items:center}header b{font-size:18px;color:#9eeac2}header span{font-size:11px;color:#a5c7b9}.card{max-width:520px;min-height:calc(100dvh - 62px);margin:0 auto;padding:26px 18px 44px;scroll-snap-align:start;display:flex;flex-direction:column;gap:14px}main{scroll-snap-type:y proximity}.eyebrow{font-size:11px;color:#89c9ae}h1{font-size:24px;line-height:1.35;margin:0}.lead{font-size:16px;margin:0;color:#cbe6d9}.diagram{display:grid;gap:8px;background:#0e2824;padding:14px;border-radius:18px}.node{border:1px solid #377b63;background:#143c32;border-radius:12px;padding:11px 14px}.node strong{color:#a5ecca}.node small{display:block;color:#b5d0c4;margin-top:4px}.arrow{text-align:center;line-height:12px;color:#77e2ac}.note,.quiz,details{border:1px solid #2e6352;background:#112e27;padding:13px;border-radius:13px}.note{font-size:13px}.quiz h2{font-size:15px;margin:0 0 7px}.quiz p{font-size:13px;margin:5px 0 9px}.quiz button{display:block;width:100%;border:1px solid #4b9277;background:#1a4939;color:#e5f7ee;text-align:left;border-radius:10px;padding:10px;margin-top:8px;font:inherit;font-size:13px}.quiz button:focus-visible{outline:2px solid #a5ecca}.feedback{color:#9eeac2}details{font-size:12px}summary{color:#9eeac2;cursor:pointer}a{color:#a5ecca;overflow-wrap:anywhere}.sources{display:flex;flex-wrap:wrap;gap:12px}.status{padding:22px;text-align:center;max-width:460px;margin:10vh auto;color:#c6d8cd}.muted{color:#91b3a3;font-size:12px}.delayed{border-color:#669e88}.delayed[hidden]{display:none}#feed[hidden]{display:none}
</style></head><body><header><b>◉ ORBIT</b><span>私有工作 · 机制学习</span></header><div id="status" class="status">正在安全读取个人知识流…</div><main id="feed" hidden></main><script>
'use strict';
const stateKey='orbit-private-learning-v3';
function readState(){try{return JSON.parse(localStorage.getItem(stateKey)||'{}')}catch(_){return {}}}
function saveState(s){try{localStorage.setItem(stateKey,JSON.stringify(s))}catch(_){}}
function el(tag,cls,txt){const x=document.createElement(tag);if(cls)x.className=cls;if(txt!==undefined)x.textContent=txt;return x}
function addText(parent,tag,cls,txt){const x=el(tag,cls,txt);parent.append(x);return x}
function makeQuiz(card,delayed=false){
 const box=el('section','quiz'+(delayed?' delayed':''));
 const q=delayed?card.transfer:card;
 addText(box,'h2','',delayed?'7 天后 · 无 AI 新情境测试':'先想一下 · 新情境');
 addText(box,'p','',q.question);
 const result=addText(box,'p','feedback','');
 const id=card.id;
 const stored=readState()[id]||{};
 if(delayed){if(!stored.firstAt||Date.now()-stored.firstAt<7*86400000)box.hidden=true;
   if(stored.transferAt){result.textContent='已完成延迟迁移测试（无 AI：'+(stored.noAI?'自报':'未确认')+'）';return box;}}
 else if(stored.firstAt){result.textContent='首测已记录；七天后开放不同情境题。';return box;}
 let noAI;
 if(delayed){const label=el('label','muted');noAI=el('input');noAI.type='checkbox';label.append(noAI,document.createTextNode(' 我这次没有借助 AI'));box.append(label);}
 q.options.forEach((option,i)=>{const btn=el('button','',String.fromCharCode(65+i)+' · '+option);btn.type='button';btn.addEventListener('click',()=>{
   const s=readState(),r=s[id]||{};
   if(delayed){if(!r.firstAt||Date.now()-r.firstAt<7*86400000||r.transferAt)return;
     r.transferAt=Date.now();r.transferCorrect=i===q.correct;r.noAI=!!noAI.checked;}
   else{if(r.firstAt)return;r.firstAt=Date.now();r.firstCorrect=i===q.correct;}
   s[id]=r;saveState(s);
   result.textContent=(i===q.correct?'✓ 正确。':'↺ 需要复习。')+' '+q.why+(delayed?'（无 AI：'+(r.noAI?'自报':'未确认')+'）':'（七天后再测）');
   box.querySelectorAll('button').forEach(b=>b.disabled=true);
 });box.append(btn);});return box;
}
function makeCard(card,i,total){const a=el('article','card');
 addText(a,'div','eyebrow','私人研究成果 · '+(i+1)+' / '+total+' · 来源绑定');
 addText(a,'h1','',card.title);addText(a,'p','lead',card.insight);
 const diagram=el('div','diagram');card.mechanism.forEach((node,j)=>{
  const n=el('div','node');addText(n,'strong','',(j+1)+'. '+node.title);addText(n,'small','',node.detail);diagram.append(n);
  if(j<card.mechanism.length-1)addText(diagram,'div','arrow','↓');});a.append(diagram);
 const note=el('div','note');addText(note,'strong','','失败反例：');note.append(document.createTextNode(card.counterexample));a.append(note);
 const d=el('details');addText(d,'summary','','来源、验证与局限');addText(d,'p','',card.verification);addText(d,'p','muted',card.evidence_level);
 const links=el('div','sources');[['code_url','源码'],['guide_url','设计'],['ci_url','CI']].forEach(([k,label])=>{
  const url=card.source[k];if(!url)return;
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='github.com')return;
  const link=el('a','',label+' ↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';links.append(link);
 });d.append(links);a.append(d);a.append(makeQuiz(card),makeQuiz(card,true));return a;
}
async function boot(){const status=document.getElementById('status'),feed=document.getElementById('feed');
 const hash=new URLSearchParams(location.hash.replace(/^#/,''));let token=hash.get('access');
 if(token&&token.length>=40){try{localStorage.setItem('orbit-access',token)}catch(_){}history.replaceState(null,'',location.pathname);}
 else{try{token=localStorage.getItem('orbit-access')}catch(_){}}
 if(!token){status.textContent='私人学习入口尚未授权。请使用专属访问链接。';return;}
 try{const r=await fetch('/api/cards',{headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit'});
 if(!r.ok){status.textContent='私人访问凭据已失效，知识内容未公开。';return;}
 const data=await r.json();if(data.privacy!=='private-library-only'||!Array.isArray(data.cards))throw Error('invalid feed');
 data.cards.forEach((c,i)=>feed.append(makeCard(c,i,data.cards.length)));
 status.hidden=true;feed.hidden=false;
 }catch(_){status.textContent='暂时无法连接私人知识库，稍后重试。';}
}
boot();
</script></body></html>'''

# A pinned script hash blocks injected inline JavaScript while allowing the one
# bundled application script. No third-party scripts or external connections.
SCRIPT = re.search(r'<script>(.*?)</script>', HTML, re.S).group(1)
SCRIPT_HASH = base64.b64encode(hashlib.sha256(SCRIPT.encode('utf-8')).digest()).decode('ascii')

class Handler(BaseHTTPRequestHandler):
    def _headers(self, status: int, mime: str, length: int):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'sha256-" + SCRIPT_HASH + "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/healthz":
            payload=b'{"ok":true}'
            self._headers(200,"application/json; charset=utf-8",len(payload))
        elif path == "/":
            payload=HTML.encode("utf-8")
            self._headers(200,"text/html; charset=utf-8",len(payload))
        elif path == "/api/cards":
            auth = self.headers.get("Authorization", "")
            valid = hmac.compare_digest(auth.encode("utf-8"), ("Bearer " + TOKEN).encode("utf-8"))
            if not valid:
                payload=b'{"error":"unauthorized"}'
                self._headers(401,"application/json; charset=utf-8",len(payload))
            else:
                payload=PRIVATE_CARDS
                self._headers(200,"application/json; charset=utf-8",len(payload))
        else:
            payload=b'{"error":"not found"}'
            self._headers(404,"application/json; charset=utf-8",len(payload))
        self.wfile.write(payload)

    def do_POST(self):
        payload=b'{"error":"method not allowed"}'
        self._headers(405,"application/json; charset=utf-8",len(payload))
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        # Do not log request paths, Authorization, or private content.
        pass

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()