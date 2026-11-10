"""Build the single-file artifact page from v4/shell.html + v4/js/*.js.

usage: python -I build.py [out.html] [--test]
  --test  adds a viewport meta (the artifact platform adds one on publish) and exposes window.__rc for browser checks
"""
import sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MODULES = ["layout.js", "campus.js", "nav.js", "importers.js", "editor.js"]
GAME = ["game-1-core.js", "game-1b-avatars.js", "game-2-world.js", "game-3-play.js", "game-4-ui.js"]
THREE = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'

TEST_HOOK = """
window.__rc={get me(){return me},get bot(){return bot},get WKEY(){return WKEY},get WM(){return WM},get DATA(){return DATA},get mode(){return mode},get route(){return route},get race(){return race},get run(){return run},
  enterWorld,goWorld,goFloor,goCampus,routeTo,startRace,runStart,applyStyle,setCam,buildIndex,modelFor,floorKeys,ride,flyTo,spawnNear,openEditor,openSetup,
  readImportText:(name,text)=>readImport(new File([text],name,{type:"text/csv"})),
  snap:()=>{fly=null;document.body.dataset.fly="0";poseFor(mode,camPos,camLook);camera.position.copy(camPos);camera.lookAt(camLook);camera.updateProjectionMatrix();renderer.render(scene,camera)},
  renderMs:n=>{n=n||5;const gl=renderer.getContext();renderer.render(scene,camera);gl.finish();const t=performance.now();for(let i=0;i<n;i++)renderer.render(scene,camera);gl.finish();return (performance.now()-t)/n},
  measureSfx:async(name,arg)=>{audio();const sv={AC,bus,noiseBuf,brownBuf,muted},sr=44100,off=new OfflineAudioContext(1,sr*2,sr);
    try{AC=off;bus=off.createGain();bus.connect(off.destination);const cp=b0=>{const b=off.createBuffer(1,Math.min(b0.length,sr*2),sr);b.copyToChannel(b0.getChannelData(0).slice(0,b.length),0);return b};noiseBuf=cp(sv.noiseBuf);brownBuf=cp(sv.brownBuf);muted=false;SFX[name](arg)}
    finally{AC=sv.AC;bus=sv.bus;noiseBuf=sv.noiseBuf;brownBuf=sv.brownBuf;muted=sv.muted}
    const d=(await off.startRendering()).getChannelData(0);let pk=0,ss=0,last=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>pk)pk=a;ss+=d[i]*d[i];if(a>.001)last=i}
    const db=x=>x>0?(20*Math.log10(x)).toFixed(1):"-inf";return{peakDb:db(pk),rmsDb:db(Math.sqrt(ss/Math.max(1,last))),ms:Math.round(last/sr*1000)}},
  get renderer(){return renderer},get scene(){return scene},get camera(){return camera},ST,get elevAt(){return elevAt},get remotes(){return remotes},syncPeers,walker,get chairs(){return chairs},carStep,groundY,setAvatar,LAYOUT,CAMPUS,NAV,IMPORT,EDITOR};
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
        if "</script" in src.lower():
            raise SystemExit(f"{f} contains </script, which would end the inline script")
        parts.append(f"/* ---- {f} ---- */\n{src.rstrip()}\n")
    body = "\n".join(parts)
    if test:
        body += TEST_HOOK
    pre = ""
    if test:  # in-memory stand-in for the claude.ai runtime, active only with #fakedb in the URL
        pre = "<script>\n" + open(os.path.join(HERE, "tests", "fake-claude.js"), encoding="utf-8").read() + "\n</script>\n"
    html = shell.rstrip() + "\n\n" + pre + THREE + "\n<script>\n(function(){\n\"use strict\";\n" + body + "\n})();\n</script>\n"
    if "--standalone" in sys.argv:
        html = html.replace("<title>Floor 4 Walkthrough</title>",
                            '<title>RC Office Campus</title>\n<meta name="description" content="Drive a remote-control car around a two-building office campus: routes to coworkers and rooms, races, coffee runs and ten graphic styles.">', 1)
    if test or "--standalone" in sys.argv:
        # a full document for local servers / GitHub Pages (the artifact platform adds this skeleton itself)
        html = ('<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n') + html + "</html>\n"
    open(out, "w", encoding="utf-8").write(html)
    print(f"wrote {out} ({len(html)//1024} KB)")


main()
