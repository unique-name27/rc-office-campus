"""Build the game page from src/shell.html + src/js/*.js.

usage: python -I build.py [out.html] [--test] [--standalone] [--inline-bakes]
  --test          adds a viewport meta (the artifact platform adds one on publish) and exposes window.__rc for browser checks
  --standalone    the public page (GitHub Pages): a full document with its own title
  --inline-bakes  puts the baked-light images in the page as data URLs (about 1.3 MB more). Without it the page loads each
                  world's two images from src/assets/bake/ beside it when the world is entered, so publish that folder
                  with the page (GitHub Pages serves it from the repo; the artifact needs it in its files).
"""
import sys, os, re, json, base64

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = ["layout.js", "campus.js", "nav.js", "importers.js", "editor.js", "people.js", "props.js", "avatar-meshes.js", "kit-meshes.js", "sound-data.js",
           "brawl.js", "pbr-data.js", "fx-data.js", "bake-data.js"]
GAME = ["game-1-core.js", "game-1b-avatars.js", "game-2-world.js", "game-2b-people.js", "game-2c-hd.js", "game-2d-fx.js", "game-2e-bake.js",
        "game-2f-physics.js", "game-3-play.js", "game-3a-brawl-art.js", "game-3b-brawl.js", "game-4-ui.js"]
# three.js r165 as ES modules from jsDelivr: one copy, shared with the add-ons through the import map
TV = "0.165.0"
IMPORTMAP = ('<script type="importmap">\n{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@%s/build/three.module.min.js",'
             '"three/addons/":"https://cdn.jsdelivr.net/npm/three@%s/examples/jsm/"}}\n</script>' % (TV, TV))
IMPORTS = """import * as THREE from "three";
import {EffectComposer} from "three/addons/postprocessing/EffectComposer.js";
import {RenderPass} from "three/addons/postprocessing/RenderPass.js";
import {GTAOPass} from "three/addons/postprocessing/GTAOPass.js";
import {UnrealBloomPass} from "three/addons/postprocessing/UnrealBloomPass.js";
import {OutputPass} from "three/addons/postprocessing/OutputPass.js";
import {RoomEnvironment} from "three/addons/environments/RoomEnvironment.js";
window.__rcLoaded=true;"""
# if the 3D library can't be fetched (offline, a blocked CDN) the module never runs: say so instead of showing a blank page
FAILSAFE = """<script>
window.__rcFail=function(){if(window.__rcLoaded)return;var f=document.getElementById("fatal");if(!f)return;f.hidden=false;f.querySelector("p").textContent="The 3D library didn't load, so the campus can't be shown. Check your connection and reload the page.";["bar","start","side","panel","mapwrap","speedo","help"].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display="none"})};
setTimeout(window.__rcFail,25000);
</script>"""

TEST_HOOK = """
window.__rc={get me(){return me},get bot(){return bot},get WKEY(){return WKEY},get WM(){return WM},get DATA(){return DATA},get mode(){return mode},get route(){return route},get race(){return race},get run(){return run},
  enterWorld,goWorld,goFloor,goCampus,routeTo,startRace,runStart,applyStyle,setCam,buildIndex,modelFor,floorKeys,ride,flyTo,spawnNear,openEditor,openSetup,
  readImportText:(name,text)=>readImport(new File([text],name,{type:"text/csv"})),
  snap:()=>{fly=null;document.body.dataset.fly="0";poseFor(mode,camPos,camLook);camera.position.copy(camPos);camera.lookAt(camLook);camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera)},
  snapFx:()=>{fly=null;document.body.dataset.fly="0";poseFor(mode,camPos,camLook);camera.position.copy(camPos);camera.lookAt(camLook);camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;HD.render(1/60)},HD,makeAvatar,dropVis,syncCar,skillFx,woofAt,get chairsList(){return chairs},get root(){return root},
  renderMs:n=>{n=n||5;const gl=renderer.getContext();renderer.render(scene,camera);gl.finish();const t=performance.now();for(let i=0;i<n;i++)renderer.render(scene,camera);gl.finish();return (performance.now()-t)/n},
  measureSfx:async(name,arg)=>{audio();const sv={AC,bus,noiseBuf,brownBuf,muted},sr=44100,off=new OfflineAudioContext(1,sr*2,sr);
    try{AC=off;bus=off.createGain();bus.connect(off.destination);const cp=b0=>{const b=off.createBuffer(1,Math.min(b0.length,sr*2),sr);b.copyToChannel(b0.getChannelData(0).slice(0,b.length),0);return b};noiseBuf=cp(sv.noiseBuf);brownBuf=cp(sv.brownBuf);muted=false;SFX[name](arg)}
    finally{AC=sv.AC;bus=sv.bus;noiseBuf=sv.noiseBuf;brownBuf=sv.brownBuf;muted=sv.muted}
    const d=(await off.startRendering()).getChannelData(0);let pk=0,ss=0,last=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a;ss+=d[i]*d[i];if(a>.001)last=i}
    const db=x=>x>0?(20*Math.log10(x)).toFixed(1):"-inf";return{peakDb:db(pk),rmsDb:db(Math.sqrt(ss/Math.max(1,last))),ms:Math.round(last/sr*1000)}},
  get renderer(){return renderer},get scene(){return scene},get camera(){return camera},ST,get elevAt(){return elevAt},get remotes(){return remotes},syncPeers,walker,get chairs(){return chairs},carStep,groundY,roomFor,onPlat,setAvatar,LAYOUT,CAMPUS,NAV,IMPORT,EDITOR,PEOPLE,
  get FIG(){return FIG},get FIGP(){return FIGP},get figG(){return figG},get LOOKS(){return LOOKS},get lookStatus(){return lookStatus},get lookDocs(){return lookDocs},get myDesk(){return myDesk},get myId(){return myId},
  recomputeLooks,rebuildFigures,figFrame,openMe,closeMe,deskClaimState,showPick,tidyChairs,chairsStep,PHYS,PROPS,spotFree,get cells(){return cells},get RAMPS(){return RAMPS},
  get SND(){return SND},get motor(){return motor},get eng(){return eng},get master(){return master},get AC(){return AC},BAKE,
  get brawl(){return brawl},brawlStart,brawlLeave,brawlUse,brawlFrame,BRAWL,get myPeer(){return myPeer},set myPeer(v){myPeer=v}};
"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    test = "--test" in sys.argv
    out = args[0] if args else os.path.join(HERE, "..", "floor-walk.html")
    shell = open(os.path.join(HERE, "shell.html"), encoding="utf-8").read()
    parts = []
    for f in MODULES + GAME:
        p = os.path.join(HERE, "js", f)
        src = open(p, encoding="utf-8").read()
        if f == "bake-data.js":
            src = bake_data(src, "--inline-bakes" in sys.argv)
        if "</script" in src.lower():
            raise SystemExit(f"{f} contains </script, which would end the inline script")
        parts.append(f"/* ---- {f} ---- */\n{src.rstrip()}\n")
    body = "\n".join(parts)
    if test:
        body += TEST_HOOK
    pre = ""
    if test:  # in-memory stand-in for the claude.ai runtime, active only with #fakedb in the URL
        pre = "<script>\n" + open(os.path.join(HERE, "tests", "fake-claude.js"), encoding="utf-8").read() + "\n</script>\n"
    html = (shell.rstrip() + "\n\n" + pre + FAILSAFE + "\n" + IMPORTMAP + '\n<script type="module" onerror="window.__rcFail()">\n' + IMPORTS
            + "\n(function(){\n\"use strict\";\n" + body + "\n})();\n</script>\n")
    if "--standalone" in sys.argv:
        html = html.replace("<title>Floor 4 Walkthrough</title>",
                            '<title>RC Office Campus</title>\n<meta name="description" content="Drive a remote-control car around a two-building office campus: routes to coworkers and rooms, races, coffee runs and five graphic styles.">', 1)
    if test or "--standalone" in sys.argv:
        # a full document for local servers / GitHub Pages (the artifact platform adds this skeleton itself)
        html = ('<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n') + html + "</html>\n"
    check_syntax(IMPORTS + "\n(function(){\n\"use strict\";\n" + body + "\n})();\n")
    open(out, "w", encoding="utf-8").write(html)
    print(f"wrote {out} ({len(html)//1024} KB)")


def bake_data(src, inline):
    """check every baked-light image the page names exists; with inline, swap the file names for data URLs"""
    m = re.search(r"const BAKES=(\{.*\});\s*$", src, re.S)
    if not m:
        raise SystemExit("bake-data.js: no BAKES table")
    bakes, d = json.loads(m.group(1)), os.path.join(HERE, "assets", "bake")
    for key, r in bakes.items():
        for f in ("f", "a"):
            if f not in r or r[f].startswith("data:"):
                continue
            p = os.path.join(d, r[f])
            if not os.path.exists(p):
                raise SystemExit(f"bake-data.js names {r[f]} for {key}, but src/assets/bake/ has no such file")
            if inline:
                mime = "image/webp" if p.endswith(".webp") else "image/avif"
                r[f] = "data:%s;base64,%s" % (mime, base64.b64encode(open(p, "rb").read()).decode())
    if not inline:
        return src
    return src[:m.start()] + "const BAKES=" + json.dumps(bakes, separators=(",", ":")) + ";\n"


def check_syntax(js):
    """refuse to write a page whose game script doesn't parse (one stray comment once blanked the whole game); needs node"""
    import shutil, subprocess, tempfile
    node = shutil.which("node")
    if not node:
        print("note: node not found, script syntax not checked")
        return
    fd, tmp = tempfile.mkstemp(suffix=".mjs")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(js)
        r = subprocess.run([node, "--check", tmp], capture_output=True, encoding="utf-8", errors="replace")
        if r.returncode:
            raise SystemExit("the game script has a syntax error, nothing written:\n" + (r.stderr or r.stdout)[-1500:])
    finally:
        os.remove(tmp)


main()
