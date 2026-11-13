window.__ModuleLoader__.load({ id: "dsh-nonead-universal-robots", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var _l=Object.defineProperty;var sp=Object.getOwnPropertyDescriptor;var rp=Object.getOwnPropertyNames;var op=Object.prototype.hasOwnProperty;var ap=(i,e)=>{for(var t in e)_l(i,t,{get:e[t],enumerable:!0})},lp=(i,e,t,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of rp(e))!op.call(i,s)&&s!==t&&_l(i,s,{get:()=>e[s],enumerable:!(n=sp(e,s))||n.enumerable});return i};var cp=i=>lp(_l({},"__esModule",{value:!0}),i);var mS={};ap(mS,{apply:()=>pS,name:()=>fS,resolveRobotIp:()=>ip});module.exports=cp(mS);var xl="/dsh-nonead-ur/twin/state",ku="/dsh-nonead-ur/twin/asset";var Hu="/dsh-nonead-ur/twin/stream";var up="frame-error",hp="stale";function dp(i,e=1e3,t=3e4){let n=Number.isFinite(e)&&e>=0?e:1e3,s=Number.isFinite(t)&&t>0?t:3e4,r=Number.isFinite(i)&&i>0?Math.floor(i):1,o=n*2**Math.min(r-1,40);return Math.min(s,Math.max(n,Number.isFinite(o)?o:s))}function Vu(i={}){let e=i.EventSourceImpl??globalThis.EventSource,t=Number.isFinite(i.retryMs)&&i.retryMs>=0?i.retryMs:1e3,n=Number.isFinite(i.maxRetryMs)&&i.maxRetryMs>0?i.maxRetryMs:3e4,s=typeof i.setTimeoutImpl=="function"?i.setTimeoutImpl:globalThis.setTimeout,r=typeof i.clearTimeoutImpl=="function"?i.clearTimeoutImpl:globalThis.clearTimeout,o=new Set,a=null,c=null,l=0,u="idle",h=null,d=!0,p=0,g=0,x=0,m=(A={kind:"status"})=>{for(let E of o)try{E(h,A)}catch{}},f=()=>{c!==null&&(r(c),c=null);let A=a;a=null;try{A?.close?.()}catch{}},T=()=>{if(d)return;if(typeof e!="function"){u="unsupported",m({kind:"status"});return}u=l===0?"connecting":"retrying";let A;try{A=new e(i.url)}catch{b();return}a=A,A.addEventListener?.("open",()=>{u="open",m({kind:"status"})}),A.addEventListener?.("state",E=>{let C;try{C=JSON.parse(E?.data??"null")}catch{return}h=C,p+=1,l=0,u="open",m({kind:"state"})}),A.addEventListener?.(hp,E=>{x+=1,m({kind:"stale",...M(E)})}),A.addEventListener?.(up,E=>{g+=1,m({kind:"frame-error",...M(E)})}),A.onerror=E=>{if(!d){if(typeof E?.data=="string"){g+=1,m({kind:"frame-error",...M(E)});return}f(),b()}}},b=()=>{if(d)return;l+=1;let A=dp(l,t,n);u="retrying",m({kind:"status"}),c!==null&&(r(c),c=null),c=s(()=>{c=null,T()},A)};function M(A){try{let E=JSON.parse(A?.data??"null");return E!==null&&typeof E=="object"?E:{}}catch{return{}}}return{subscribe(A){return o.add(A),()=>o.delete(A)},start(){d&&(d=!1,l=0,T())},stop(){d=!0,f(),u="idle"},poke(A=!1){return d||a!==null&&A!==!0?!1:(c!==null&&(r(c),c=null),f(),T(),!0)},getSnapshot:()=>h,getStatus:()=>u,getFrames:()=>p,getFrameErrors:()=>g,getStaleCount:()=>x}}function Gu(i,e){let t=typeof i=="string"&&i!==""?i:"/dsh-nonead-ur/twin/stream",n=typeof e=="string"?e.trim():"";return n===""?t:`${t}?ip=${encodeURIComponent(n)}`}function fp(i,e,t,n){return e?t:Math.min(n,Math.max(t,i*2))}function pp(i){return`${i}${i.includes("?")?"&":"?"}detail=1`}function Wu({fetchImpl:i=globalThis.fetch,ip:e,baseMs:t=100,maxMs:n=2e3,detailMs:s=2e3,now:r=()=>Date.now(),stream:o=!1,streamFactory:a}={}){let c=typeof e=="string"&&e.trim()!==""?e.trim():"",l=y=>y===""?xl:`${xl}?ip=${encodeURIComponent(y)}`,u=l(c),h=-1/0,d={connected:!1,model:"",q:[],tcp:[],ts:0,error:null,code:null,ips:[],ip:null,degraded:!1,detail:null,pendingMotion:null,feedStale:!1,feedPendingMs:null},p=new Set,g=null,x=t,m=!0,f=0,T=null,b=null,M=null;function A(){M!==null&&(M(),M=null),b?.stop?.(),b=null}function E(){A(),b=(typeof a=="function"?a:Vu)({url:Gu(Hu,c)}),M=b.subscribe((P,F)=>{if(!m){if(F?.kind==="stale"||F?.kind==="frame-error"){d={...d,feedStale:!0,feedPendingMs:Number.isFinite(F?.pendingMs)?F.pendingMs:d.feedPendingMs},C();return}if(F?.kind==="status"){C();return}P!=null&&(D(P),C())}}),m||b.start()}let C=()=>{for(let y of p)try{y(d)}catch{}};function D(y){let P=y?.connected===!0;return d=P?{connected:!0,model:y.model,q:y.q,tcp:y.tcp,ts:y.ts,error:null,code:null,ips:[],ip:y.ip??null,degraded:y.degraded===!0,detail:y.detail??d.detail??null,pendingMotion:y.pending_motion??null,feedStale:y.stale===!0,feedPendingMs:Number.isFinite(y.stale_ms)?y.stale_ms:null}:{...d,connected:!1,error:y?.reason??y?.error??"not connected",code:y?.code??null,ips:Array.isArray(y?.ips)?y.ips:[],ip:y?.ip??d.ip??null,degraded:!1,pendingMotion:null,feedStale:!1,feedPendingMs:null},P}async function S(y){let P=!1,F=d.connected===!0&&r()-h>=Math.max(0,s);F&&(h=r());try{let H=typeof AbortController=="function"?new AbortController:null;T=H;let W=await(await i(F?pp(u):u,H?{cache:"no-store",signal:H.signal}:void 0)).json();P=D(W)}catch(H){if(H instanceof Error&&H.name==="AbortError")return;d={...d,connected:!1,error:H instanceof Error?H.message:String(H),code:null,degraded:!1},P=!1}finally{T=null}if(m||y!==f)return;C(),x=fp(x,P,t,n);let k=typeof document<"u"&&document.hidden===!0;g=setTimeout(()=>S(y),k?n:x)}return{subscribe(y){return p.add(y),()=>p.delete(y)},getSnapshot:()=>d,setIp(y){let P=typeof y=="string"?y.trim():"";if(P!==c){if(c=P,u=l(P),d={...d,connected:!1,model:"",q:[],tcp:[],ts:0,error:null,code:null,ips:[],ip:P===""?null:P,degraded:!1,detail:null,pendingMotion:null},C(),o){m||E();return}try{T?.abort?.()}catch{}T=null,m||S(++f)}},getIp:()=>c,getStreamHealth(){let y=b;return{mode:o?"stream":"poll",status:o?typeof y?.getStatus=="function"?y.getStatus():"idle":"polling",frames:typeof y?.getFrames=="function"?y.getFrames():0,frameErrors:typeof y?.getFrameErrors=="function"?y.getFrameErrors():0,stale:typeof y?.getStaleCount=="function"?y.getStaleCount():0,connected:d.connected===!0}},retryNow(y=!1){if(m)return!1;if(o)return b?.poke?.(y)===!0;g&&(clearTimeout(g),g=null);try{T?.abort?.()}catch{}return T=null,S(++f),!0},start(){if(m){if(m=!1,o){E();return}S(++f)}},stop(){if(m=!0,f++,o){A();return}g&&(clearTimeout(g),g=null);try{T?.abort?.()}catch{}T=null}}}var Zr="__DSH_UR_TWIN_MUTATION_HUB__";function qi(){return typeof globalThis>"u"?void 0:globalThis}function mp(i,e){if(typeof e=="function")return e;let t=i?.defaultView?.MutationObserver;if(typeof t=="function")return t;let n=qi()?.MutationObserver;return typeof n=="function"?n:void 0}function gp(i,e){if(typeof e=="function")return e;let t=i?.defaultView;if(t&&typeof t.requestAnimationFrame=="function")return s=>t.requestAnimationFrame(s);let n=qi()?.requestAnimationFrame;return typeof n=="function"?s=>n(s):void 0}function _p(i,e){if(typeof e=="function")return e;let t=i?.defaultView;if(t&&typeof t.cancelAnimationFrame=="function")return s=>t.cancelAnimationFrame(s);let n=qi()?.cancelAnimationFrame;return typeof n=="function"?s=>n(s):void 0}var Jr;function xp(){let i=qi();return i?i[Zr]:Jr}function yp(i){let e=qi();e?e[Zr]=i:Jr=i}function vp(i){let e=qi();e?e[Zr]===i&&delete e[Zr]:Jr===i&&(Jr=void 0)}function Sp({doc:i,options:e}){let t=mp(i,e.MutationObserver),n=gp(i,e.raf),s=_p(i,e.caf),r=new Set,o={subscribers:r,pending:[],scheduled:!1,frame:void 0,observer:void 0,raf:n,caf:s},a=()=>{o.frame=void 0,o.scheduled=!1;let u=o.pending;o.pending=[];for(let h of[...r])if(r.has(h))try{h(u)}catch{}},c=()=>{if(!o.scheduled){if(o.scheduled=!0,typeof n=="function")try{o.frame=n(a);return}catch{}a()}},l=i?i.body??i.documentElement:void 0;if(typeof t=="function"&&l)try{o.observer=new t(u=>{for(let h of u)o.pending.push(h);c()}),o.observer.observe(l,{childList:!0,subtree:!0})}catch{o.observer=void 0}return o}function Xu(i,e,t){let n=xp();n===void 0&&(n=Sp({doc:i,options:e}),n.observer&&yp(n)),n.subscribers.add(t);let s=!0;return()=>{if(s&&(s=!1,n.subscribers.delete(t),!(n.subscribers.size>0))){try{n.observer?.disconnect?.()}catch{}if(n.frame!==void 0&&typeof n.caf=="function")try{n.caf(n.frame)}catch{}n.frame=void 0,n.scheduled=!1,n.pending=[],vp(n)}}}var Mp={statusDisconnected:"\u672A\u8FDE\u63A5\u673A\u5668\u4EBA",statusLoading:"\u5DF2\u8FDE\u63A5 \xB7 \u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u2026",statusConnected:"\u5DF2\u8FDE\u63A5",statusFallbackSuffix:"\uFF08\u65E0\u5185\u7F6E\u6A21\u578B\uFF0C\u4F7F\u7528\u8FD1\u4F3C\u51E0\u4F55\u4F53\uFF09",statusErrorPrefix:"\u6E32\u67D3\u5F02\u5E38\uFF1A",statusLoadFailed:"\u6A21\u578B\u52A0\u8F7D\u5931\u8D25\uFF1A",statusNoWebgl:"\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 WebGL\uFF1A\u5DF2\u5207\u6362\u4E3A\u7EAF\u6570\u503C\u6A21\u5F0F\uFF08\u5173\u8282\u89D2\u4E0E TCP \u4ECD\u4F1A\u66F4\u65B0\uFF09",statusIncomplete:"\u673A\u5668\u4EBA\u672A\u8FD4\u56DE\u5B8C\u6574\u7684\u5173\u8282\u89D2",statusContextLost:"3D \u4E0A\u4E0B\u6587\u4E22\u5931\uFF08GPU \u91CD\u7F6E\uFF09\u2014\u2014 \u6536\u8D77\u5E76\u91CD\u65B0\u5C55\u5F00\u9762\u677F\u53EF\u6062\u590D",statusSafetyHint:"\u673A\u5668\u4EBA\u53EF\u80FD\u5DF2\u505C\u6B62\uFF0C\u8BF7\u68C0\u67E5\u793A\u6559\u5668",disconnectNeverConnected:"\u672A\u8FDE\u63A5\u673A\u5668\u4EBA\uFF1A\u8FD8\u6CA1\u6709\u6210\u529F\u6267\u884C\u8FC7 ur_connect",disconnectReason:i=>`\u673A\u5668\u4EBA\u672A\u8FDE\u63A5${i?`\uFF1A${i}`:""}`,disconnectAmbiguous:i=>`\u68C0\u6D4B\u5230\u591A\u53F0\u5DF2\u8FDE\u63A5\u673A\u5668\u4EBA\uFF0C\u8BF7\u6307\u5B9A\u673A\u5668\u4EBA IP${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?`\uFF08\u5019\u9009\uFF1A${i.join("\u3001")}\uFF09`:"",disconnectWorkerDown:i=>`UR \u63A7\u5236\u8FDB\u7A0B\u4E0D\u53EF\u7528${i?`\uFF1A${i}`:""}\uFF08\u53EF\u8FD0\u884C ur_ping \u81EA\u68C0 Python \u4F9D\u8D56\uFF09`,disconnectReadFailed:i=>`\u8BFB\u53D6\u673A\u5668\u4EBA\u72B6\u6001\u5931\u8D25${i?`\uFF1A${i}`:""}`,jointsPrefix:"\u5173\u8282\u89D2 (\xB0)",tcpPrefix:"TCP(\u7C73/\u8F74\u89D2\u5F27\u5EA6)",queryFailed:"\u67E5\u8BE2\u5931\u8D25",detailStatusFailed:i=>`\u72B6\u6001\u67E5\u8BE2\u5931\u8D25\uFF1A${i}`,detailSafety:i=>`\u5B89\u5168 ${i}`,detailRobotMode:i=>`\u6A21\u5F0F ${i}`,detailProgram:i=>`\u7A0B\u5E8F ${i}`,detailSpeed:i=>`\u901F\u5EA6 ${i}`,detailRunning:"\u8FD0\u884C\u4E2D",detailTempsPrefix:"\u6E29\u5EA6(\xB0C)",detailTemps:i=>`\u6E29\u5EA6(\xB0C)  ${i}`,detailBus:(i,e)=>`\u6BCD\u7EBF ${i} V  ${e} A`,overLimit:i=>`\u26A0 \u8D85\u9650 ${i}`,feedStale:"\u6570\u636E\u5DF2\u505C\u6B62\u66F4\u65B0",feedRetrying:"\u6570\u636E\u901A\u9053\u91CD\u8FDE\u4E2D\u2026",feedRetryWord:"\u6B63\u5728\u91CD\u8BD5",feedNoEventSource:"\u5F53\u524D\u73AF\u5883\u6CA1\u6709 EventSource",feedFrames:(i,e)=>`\uFF08\u5DF2\u6536 ${i} \u5E27${e>0?`\uFF0C\u5931\u8D25 ${e} \u5E27`:""}\uFF09`,safetyMode:{NORMAL:"\u6B63\u5E38",REDUCED:"\u7F29\u51CF\u6A21\u5F0F",PROTECTIVE_STOP:"\u4FDD\u62A4\u6027\u505C\u6B62",SAFEGUARD_STOP:"\u5B89\u5168\u505C\u6B62",EMERGENCY_STOP:"\u6025\u505C",SYSTEM_EMERGENCY_STOP:"\u7CFB\u7EDF\u6025\u505C",ROBOT_EMERGENCY_STOP:"\u673A\u5668\u4EBA\u6025\u505C",RECOVERY:"\u6062\u590D\u4E2D",VIOLATION:"\u8FDD\u53CD\u5B89\u5168\u9650\u5236",FAULT:"\u6545\u969C",AUTOMATIC_MODE_SAFEGUARD_STOP:"\u81EA\u52A8\u6A21\u5F0F\u5B89\u5168\u505C\u6B62",SYSTEM_THREE_POSITION_ENABLING_STOP:"\u4E09\u4F4D\u4F7F\u80FD\u505C\u6B62"},robotMode:{POWER_OFF:"\u5DF2\u4E0B\u7535",POWER_ON:"\u5DF2\u4E0A\u7535",IDLE:"\u7A7A\u95F2",BACKDRIVE:"\u62D6\u52A8",RUNNING:"\u8FD0\u884C\u4E2D",BOOTING:"\u542F\u52A8\u4E2D",CONFIRM_SAFETY:"\u5F85\u786E\u8BA4\u5B89\u5168",DISCONNECTED:"\u672A\u8FDE\u63A5",NO_CONTROLLER:"\u65E0\u63A7\u5236\u5668"},programState:{STOPPED:"\u5DF2\u505C\u6B62",PLAYING:"\u8FD0\u884C\u4E2D",PAUSED:"\u5DF2\u6682\u505C"},viewReset:"\u91CD\u7F6E\u89C6\u89D2",viewIso:"\u7B49\u8F74\u6D4B",viewFront:"\u524D\u89C6",viewSide:"\u4FA7\u89C6",viewTop:"\u4FEF\u89C6",identity:(i,e)=>`\u673A\u5668\u4EBA  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"\u5F85\u5BA1\u6279",canvasLabel:"\u673A\u5668\u4EBA\u6570\u5B57\u5B6A\u751F 3D \u89C6\u56FE\uFF1B\u53EF\u7528\u65B9\u5411\u952E\u5207\u6362\u89C6\u89D2",hudLabel:"\u673A\u5668\u4EBA\u5B9E\u65F6\u8BFB\u6570",layerReach:"\u53EF\u8FBE\u8303\u56F4",layerBase:"\u57FA\u5EA7\u7CFB",layerForce:"\u53D7\u529B",screenshot:"\u622A\u56FE",screenshotLabel:"\u5BFC\u51FA\u5E26\u6C34\u5370\u7684\u622A\u56FE",trajectoryClear:"\u6E05\u8F68\u8FF9",trajectoryPause:"\u6682\u505C\u8F68\u8FF9",trajectoryResume:"\u7EE7\u7EED\u8BB0\u5F55",trajectoryExport:"\u5BFC\u51FA\u8F68\u8FF9",dockLabel:"\u62D3\u5FB7UR\u6570\u5B57\u5B6A\u751F",dockDescription:"\u673A\u5668\u4EBA\u5B9E\u65F6\u5B6A\u751F\u89C6\u56FE",dockCollapse:"\u6536\u8D77"},bp={statusDisconnected:"Robot not connected",statusLoading:"Connected \xB7 loading model\u2026",statusConnected:"Connected",statusFallbackSuffix:" (no built-in model, using approximate geometry)",statusErrorPrefix:"Render error: ",statusLoadFailed:"Model failed to load: ",statusNoWebgl:"WebGL is unavailable here: switched to numeric-only mode (joint angles and TCP keep updating)",statusIncomplete:"The robot did not return a full set of joint angles",statusContextLost:"3D context lost (GPU reset) \u2014 collapse and reopen the panel to recover",statusSafetyHint:"The robot may have stopped; check the teach pendant",disconnectNeverConnected:"Robot not connected: ur_connect has never succeeded",disconnectReason:i=>`Robot not connected${i?`: ${i}`:""}`,disconnectAmbiguous:i=>`More than one robot is connected; specify the robot IP${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (candidates: ${i.join(", ")})`:"",disconnectWorkerDown:i=>`The UR control process is unavailable${i?`: ${i}`:""} (run ur_ping to check the Python dependencies)`,disconnectReadFailed:i=>`Failed to read the robot state${i?`: ${i}`:""}`,jointsPrefix:"Joint angles (\xB0)",tcpPrefix:"TCP (m / axis-angle rad)",queryFailed:"query failed",detailStatusFailed:i=>`Status query failed: ${i}`,detailSafety:i=>`Safety ${i}`,detailRobotMode:i=>`Mode ${i}`,detailProgram:i=>`Program ${i}`,detailSpeed:i=>`Speed ${i}`,detailRunning:"Running",detailTempsPrefix:"Temp (\xB0C)",detailTemps:i=>`Temp (\xB0C)  ${i}`,detailBus:(i,e)=>`Bus ${i} V  ${e} A`,overLimit:i=>`\u26A0 over limit ${i}`,feedStale:"Data has stopped updating",feedRetrying:"Reconnecting the data channel\u2026",feedRetryWord:"retrying",feedNoEventSource:"EventSource is unavailable here",feedFrames:(i,e)=>` (${i} frames${e>0?`, ${e} failed`:""})`,safetyMode:{NORMAL:"Normal",REDUCED:"Reduced",PROTECTIVE_STOP:"Protective stop",SAFEGUARD_STOP:"Safeguard stop",EMERGENCY_STOP:"Emergency stop",SYSTEM_EMERGENCY_STOP:"System emergency stop",ROBOT_EMERGENCY_STOP:"Robot emergency stop",RECOVERY:"Recovery",VIOLATION:"Safety violation",FAULT:"Fault",AUTOMATIC_MODE_SAFEGUARD_STOP:"Automatic-mode safeguard stop",SYSTEM_THREE_POSITION_ENABLING_STOP:"Three-position enabling stop"},robotMode:{POWER_OFF:"Power off",POWER_ON:"Power on",IDLE:"Idle",BACKDRIVE:"Backdrive",RUNNING:"Running",BOOTING:"Booting",CONFIRM_SAFETY:"Confirm safety",DISCONNECTED:"Disconnected",NO_CONTROLLER:"No controller"},programState:{STOPPED:"Stopped",PLAYING:"Playing",PAUSED:"Paused"},viewReset:"Reset view",viewIso:"Isometric",viewFront:"Front",viewSide:"Side",viewTop:"Top",identity:(i,e)=>`Robot  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"Pending approval",canvasLabel:"Robot digital-twin 3D view; arrow keys switch the view",hudLabel:"Live robot readouts",layerReach:"Reach",layerBase:"Base frame",layerForce:"Force",screenshot:"Screenshot",screenshotLabel:"Export a watermarked screenshot",trajectoryClear:"Clear path",trajectoryPause:"Pause path",trajectoryResume:"Resume path",trajectoryExport:"Export path",dockLabel:"Nonead UR digital twin",dockDescription:"Live robot twin view",dockCollapse:"Collapse"},Tp={statusDisconnected:"\u30ED\u30DC\u30C3\u30C8\u672A\u63A5\u7D9A",statusLoading:"\u63A5\u7D9A\u6E08\u307F \xB7 \u30E2\u30C7\u30EB\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026",statusConnected:"\u63A5\u7D9A\u6E08\u307F",statusFallbackSuffix:"\uFF08\u7D44\u307F\u8FBC\u307F\u30E2\u30C7\u30EB\u304C\u306A\u3044\u305F\u3081\u8FD1\u4F3C\u5F62\u72B6\u3092\u4F7F\u7528\uFF09",statusErrorPrefix:"\u63CF\u753B\u30A8\u30E9\u30FC\uFF1A",statusLoadFailed:"\u30E2\u30C7\u30EB\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\uFF1A",statusNoWebgl:"\u3053\u306E\u74B0\u5883\u3067\u306F WebGL \u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\uFF1A\u6570\u5024\u306E\u307F\u306E\u30E2\u30FC\u30C9\u306B\u5207\u308A\u66FF\u3048\u307E\u3057\u305F\uFF08\u95A2\u7BC0\u89D2\u3068 TCP \u306F\u66F4\u65B0\u3092\u7D9A\u3051\u307E\u3059\uFF09",statusIncomplete:"\u30ED\u30DC\u30C3\u30C8\u304B\u3089\u5B8C\u5168\u306A\u95A2\u7BC0\u89D2\u304C\u8FD4\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F",statusContextLost:"3D \u30B3\u30F3\u30C6\u30AD\u30B9\u30C8\u304C\u5931\u308F\u308C\u307E\u3057\u305F\uFF08GPU \u30EA\u30BB\u30C3\u30C8\uFF09\u2014\u2014 \u30D1\u30CD\u30EB\u3092\u6298\u308A\u305F\u305F\u3093\u3067\u958B\u304D\u76F4\u3059\u3068\u5FA9\u5E30\u3057\u307E\u3059",statusSafetyHint:"\u30ED\u30DC\u30C3\u30C8\u304C\u505C\u6B62\u3057\u3066\u3044\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002\u30C6\u30A3\u30FC\u30C1\u30DA\u30F3\u30C0\u30F3\u30C8\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044",disconnectNeverConnected:"\u30ED\u30DC\u30C3\u30C8\u672A\u63A5\u7D9A\uFF1Aur_connect \u304C\u307E\u3060\u4E00\u5EA6\u3082\u6210\u529F\u3057\u3066\u3044\u307E\u305B\u3093",disconnectReason:i=>`\u30ED\u30DC\u30C3\u30C8\u672A\u63A5\u7D9A${i?`\uFF1A${i}`:""}`,disconnectAmbiguous:i=>`\u8907\u6570\u306E\u30ED\u30DC\u30C3\u30C8\u304C\u63A5\u7D9A\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u30ED\u30DC\u30C3\u30C8\u306E IP \u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?`\uFF08\u5019\u88DC\uFF1A${i.join("\u3001")}\uFF09`:"",disconnectWorkerDown:i=>`UR \u5236\u5FA1\u30D7\u30ED\u30BB\u30B9\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093${i?`\uFF1A${i}`:""}\uFF08ur_ping \u3067 Python \u4F9D\u5B58\u95A2\u4FC2\u3092\u78BA\u8A8D\u3067\u304D\u307E\u3059\uFF09`,disconnectReadFailed:i=>`\u30ED\u30DC\u30C3\u30C8\u72B6\u614B\u306E\u8AAD\u307F\u53D6\u308A\u306B\u5931\u6557${i?`\uFF1A${i}`:""}`,jointsPrefix:"\u95A2\u7BC0\u89D2 (\xB0)",tcpPrefix:"TCP(\u30E1\u30FC\u30C8\u30EB/\u8EF8\u89D2\u30E9\u30B8\u30A2\u30F3)",queryFailed:"\u30AF\u30A8\u30EA\u5931\u6557",detailStatusFailed:i=>`\u72B6\u614B\u30AF\u30A8\u30EA\u5931\u6557\uFF1A${i}`,detailSafety:i=>`\u5B89\u5168 ${i}`,detailRobotMode:i=>`\u30E2\u30FC\u30C9 ${i}`,detailProgram:i=>`\u30D7\u30ED\u30B0\u30E9\u30E0 ${i}`,detailSpeed:i=>`\u901F\u5EA6 ${i}`,detailRunning:"\u5B9F\u884C\u4E2D",detailTempsPrefix:"\u6E29\u5EA6(\xB0C)",detailTemps:i=>`\u6E29\u5EA6(\xB0C)  ${i}`,detailBus:(i,e)=>`\u6BCD\u7DDA ${i} V  ${e} A`,overLimit:i=>`\u26A0 \u4E0A\u9650\u8D85\u904E ${i}`,feedStale:"\u30C7\u30FC\u30BF\u306E\u66F4\u65B0\u304C\u505C\u6B62\u3057\u307E\u3057\u305F",feedRetrying:"\u30C7\u30FC\u30BF\u30C1\u30E3\u30CD\u30EB\u3092\u518D\u63A5\u7D9A\u4E2D\u2026",feedRetryWord:"\u518D\u8A66\u884C\u4E2D",feedNoEventSource:"\u3053\u306E\u74B0\u5883\u306B\u306F EventSource \u304C\u3042\u308A\u307E\u305B\u3093",feedFrames:(i,e)=>`\uFF08\u53D7\u4FE1 ${i} \u30D5\u30EC\u30FC\u30E0${e>0?`\u3001\u5931\u6557 ${e} \u30D5\u30EC\u30FC\u30E0`:""}\uFF09`,safetyMode:{NORMAL:"\u6B63\u5E38",REDUCED:"\u7E2E\u5C0F\u30E2\u30FC\u30C9",PROTECTIVE_STOP:"\u4FDD\u8B77\u505C\u6B62",SAFEGUARD_STOP:"\u30BB\u30FC\u30D5\u30AC\u30FC\u30C9\u505C\u6B62",EMERGENCY_STOP:"\u7DCA\u6025\u505C\u6B62",SYSTEM_EMERGENCY_STOP:"\u30B7\u30B9\u30C6\u30E0\u7DCA\u6025\u505C\u6B62",ROBOT_EMERGENCY_STOP:"\u30ED\u30DC\u30C3\u30C8\u7DCA\u6025\u505C\u6B62",RECOVERY:"\u5FA9\u5E30\u4E2D",VIOLATION:"\u5B89\u5168\u5236\u9650\u9055\u53CD",FAULT:"\u6545\u969C",AUTOMATIC_MODE_SAFEGUARD_STOP:"\u81EA\u52D5\u30E2\u30FC\u30C9\u306E\u30BB\u30FC\u30D5\u30AC\u30FC\u30C9\u505C\u6B62",SYSTEM_THREE_POSITION_ENABLING_STOP:"3 \u4F4D\u7F6E\u30A4\u30CD\u30FC\u30D6\u30EB\u505C\u6B62"},robotMode:{POWER_OFF:"\u96FB\u6E90\u30AA\u30D5",POWER_ON:"\u96FB\u6E90\u30AA\u30F3",IDLE:"\u30A2\u30A4\u30C9\u30EB",BACKDRIVE:"\u30D0\u30C3\u30AF\u30C9\u30E9\u30A4\u30D6",RUNNING:"\u5B9F\u884C\u4E2D",BOOTING:"\u8D77\u52D5\u4E2D",CONFIRM_SAFETY:"\u5B89\u5168\u306E\u78BA\u8A8D\u5F85\u3061",DISCONNECTED:"\u672A\u63A5\u7D9A",NO_CONTROLLER:"\u30B3\u30F3\u30C8\u30ED\u30FC\u30E9\u306A\u3057"},programState:{STOPPED:"\u505C\u6B62",PLAYING:"\u5B9F\u884C\u4E2D",PAUSED:"\u4E00\u6642\u505C\u6B62"},viewReset:"\u8996\u70B9\u3092\u30EA\u30BB\u30C3\u30C8",viewIso:"\u7B49\u89D2\u6295\u5F71",viewFront:"\u6B63\u9762",viewSide:"\u5074\u9762",viewTop:"\u4E0A\u9762",identity:(i,e)=>`\u30ED\u30DC\u30C3\u30C8  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"\u627F\u8A8D\u5F85\u3061",canvasLabel:"\u30ED\u30DC\u30C3\u30C8\u30C7\u30B8\u30BF\u30EB\u30C4\u30A4\u30F3\u306E 3D \u30D3\u30E5\u30FC\uFF1B\u77E2\u5370\u30AD\u30FC\u3067\u8996\u70B9\u3092\u5207\u308A\u66FF\u3048",hudLabel:"\u30ED\u30DC\u30C3\u30C8\u306E\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u5024",layerReach:"\u5230\u9054\u7BC4\u56F2",layerBase:"\u30D9\u30FC\u30B9\u5EA7\u6A19\u7CFB",layerForce:"\u529B",screenshot:"\u30B9\u30AF\u30EA\u30FC\u30F3\u30B7\u30E7\u30C3\u30C8",screenshotLabel:"\u900F\u304B\u3057\u5165\u308A\u306E\u30B9\u30AF\u30EA\u30FC\u30F3\u30B7\u30E7\u30C3\u30C8\u3092\u66F8\u304D\u51FA\u3059",trajectoryClear:"\u8ECC\u8DE1\u3092\u6D88\u53BB",trajectoryPause:"\u8ECC\u8DE1\u3092\u4E00\u6642\u505C\u6B62",trajectoryResume:"\u8A18\u9332\u3092\u518D\u958B",trajectoryExport:"\u8ECC\u8DE1\u3092\u66F8\u304D\u51FA\u3059",dockLabel:"Nonead UR \u30C7\u30B8\u30BF\u30EB\u30C4\u30A4\u30F3",dockDescription:"\u30ED\u30DC\u30C3\u30C8\u306E\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u30C4\u30A4\u30F3\u8868\u793A",dockCollapse:"\u6298\u308A\u305F\u305F\u3080"},Ep={statusDisconnected:"Robot no conectado",statusLoading:"Conectado \xB7 cargando modelo\u2026",statusConnected:"Conectado",statusFallbackSuffix:" (sin modelo integrado; se usa geometr\xEDa aproximada)",statusErrorPrefix:"Error de renderizado: ",statusLoadFailed:"No se pudo cargar el modelo: ",statusNoWebgl:"WebGL no est\xE1 disponible aqu\xED: se cambi\xF3 al modo solo num\xE9rico (los \xE1ngulos de las articulaciones y el TCP siguen actualiz\xE1ndose)",statusIncomplete:"El robot no devolvi\xF3 el conjunto completo de \xE1ngulos de articulaci\xF3n",statusContextLost:"Se perdi\xF3 el contexto 3D (reinicio de la GPU) \u2014 contraiga y vuelva a abrir el panel para recuperarlo",statusSafetyHint:"Es posible que el robot se haya detenido; revise el teach pendant",disconnectNeverConnected:"Robot no conectado: ur_connect nunca se ha ejecutado con \xE9xito",disconnectReason:i=>`Robot no conectado${i?`: ${i}`:""}`,disconnectAmbiguous:i=>`Hay m\xE1s de un robot conectado; indique la IP del robot${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (candidatos: ${i.join(", ")})`:"",disconnectWorkerDown:i=>`El proceso de control de UR no est\xE1 disponible${i?`: ${i}`:""} (ejecute ur_ping para comprobar las dependencias de Python)`,disconnectReadFailed:i=>`No se pudo leer el estado del robot${i?`: ${i}`:""}`,jointsPrefix:"\xC1ngulos de articulaci\xF3n (\xB0)",tcpPrefix:"TCP (m / rad de eje-\xE1ngulo)",queryFailed:"consulta fallida",detailStatusFailed:i=>`Fall\xF3 la consulta de estado: ${i}`,detailSafety:i=>`Seguridad ${i}`,detailRobotMode:i=>`Modo ${i}`,detailProgram:i=>`Programa ${i}`,detailSpeed:i=>`Velocidad ${i}`,detailRunning:"En ejecuci\xF3n",detailTempsPrefix:"Temp (\xB0C)",detailTemps:i=>`Temp (\xB0C)  ${i}`,detailBus:(i,e)=>`Bus ${i} V  ${e} A`,overLimit:i=>`\u26A0 fuera de l\xEDmite ${i}`,feedStale:"Los datos dejaron de actualizarse",feedRetrying:"Reconectando el canal de datos\u2026",feedRetryWord:"reintentando",feedNoEventSource:"EventSource no est\xE1 disponible aqu\xED",feedFrames:(i,e)=>` (${i} tramas${e>0?`, ${e} con error`:""})`,safetyMode:{NORMAL:"Normal",REDUCED:"Reducido",PROTECTIVE_STOP:"Parada de protecci\xF3n",SAFEGUARD_STOP:"Parada de salvaguarda",EMERGENCY_STOP:"Parada de emergencia",SYSTEM_EMERGENCY_STOP:"Parada de emergencia del sistema",ROBOT_EMERGENCY_STOP:"Parada de emergencia del robot",RECOVERY:"Recuperaci\xF3n",VIOLATION:"Violaci\xF3n de seguridad",FAULT:"Fallo",AUTOMATIC_MODE_SAFEGUARD_STOP:"Parada de salvaguarda en modo autom\xE1tico",SYSTEM_THREE_POSITION_ENABLING_STOP:"Parada de habilitaci\xF3n de tres posiciones"},robotMode:{POWER_OFF:"Apagado",POWER_ON:"Encendido",IDLE:"Inactivo",BACKDRIVE:"Arrastre manual",RUNNING:"En ejecuci\xF3n",BOOTING:"Arrancando",CONFIRM_SAFETY:"Confirmar seguridad",DISCONNECTED:"Desconectado",NO_CONTROLLER:"Sin controlador"},programState:{STOPPED:"Detenido",PLAYING:"En ejecuci\xF3n",PAUSED:"Pausado"},viewReset:"Restablecer vista",viewIso:"Isom\xE9trica",viewFront:"Frontal",viewSide:"Lateral",viewTop:"Superior",identity:(i,e)=>`Robot  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"Aprobaci\xF3n pendiente",canvasLabel:"Vista 3D del gemelo digital del robot; las flechas cambian la vista",hudLabel:"Lecturas del robot en vivo",layerReach:"Alcance",layerBase:"Sistema base",layerForce:"Fuerza",screenshot:"Captura",screenshotLabel:"Exportar una captura con marca de agua",trajectoryClear:"Borrar trayectoria",trajectoryPause:"Pausar trayectoria",trajectoryResume:"Reanudar registro",trajectoryExport:"Exportar trayectoria",dockLabel:"Gemelo digital UR de Nonead",dockDescription:"Vista en vivo del gemelo del robot",dockCollapse:"Contraer"},Ap={statusDisconnected:"Robot non connect\xE9",statusLoading:"Connect\xE9 \xB7 chargement du mod\xE8le\u2026",statusConnected:"Connect\xE9",statusFallbackSuffix:" (aucun mod\xE8le int\xE9gr\xE9, g\xE9om\xE9trie approch\xE9e utilis\xE9e)",statusErrorPrefix:"Erreur de rendu : ",statusLoadFailed:"\xC9chec du chargement du mod\xE8le : ",statusNoWebgl:"WebGL n'est pas disponible ici : passage en mode num\xE9rique seul (les angles d'articulation et le TCP continuent d'\xEAtre actualis\xE9s)",statusIncomplete:"Le robot n'a pas renvoy\xE9 l'ensemble complet des angles d'articulation",statusContextLost:"Contexte 3D perdu (r\xE9initialisation du GPU) \u2014 repliez puis rouvrez le panneau pour le r\xE9cup\xE9rer",statusSafetyHint:"Le robot a peut-\xEAtre \xE9t\xE9 arr\xEAt\xE9 ; v\xE9rifiez le teach pendant",disconnectNeverConnected:"Robot non connect\xE9 : ur_connect n'a jamais r\xE9ussi",disconnectReason:i=>`Robot non connect\xE9${i?` : ${i}`:""}`,disconnectAmbiguous:i=>`Plusieurs robots sont connect\xE9s ; pr\xE9cisez l'adresse IP du robot${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (candidats : ${i.join(", ")})`:"",disconnectWorkerDown:i=>`Le processus de contr\xF4le UR est indisponible${i?` : ${i}`:""} (ex\xE9cutez ur_ping pour v\xE9rifier les d\xE9pendances Python)`,disconnectReadFailed:i=>`\xC9chec de la lecture de l'\xE9tat du robot${i?` : ${i}`:""}`,jointsPrefix:"Angles d'articulation (\xB0)",tcpPrefix:"TCP (m / rad axe-angle)",queryFailed:"\xE9chec de la requ\xEAte",detailStatusFailed:i=>`\xC9chec de la requ\xEAte d'\xE9tat : ${i}`,detailSafety:i=>`S\xE9curit\xE9 ${i}`,detailRobotMode:i=>`Mode ${i}`,detailProgram:i=>`Programme ${i}`,detailSpeed:i=>`Vitesse ${i}`,detailRunning:"En cours",detailTempsPrefix:"Temp (\xB0C)",detailTemps:i=>`Temp (\xB0C)  ${i}`,detailBus:(i,e)=>`Bus ${i} V  ${e} A`,overLimit:i=>`\u26A0 hors limite ${i}`,feedStale:"Les donn\xE9es ne se mettent plus \xE0 jour",feedRetrying:"Reconnexion du canal de donn\xE9es\u2026",feedRetryWord:"nouvelle tentative",feedNoEventSource:"EventSource n'est pas disponible ici",feedFrames:(i,e)=>` (${i} trames${e>0?`, ${e} en \xE9chec`:""})`,safetyMode:{NORMAL:"Normal",REDUCED:"R\xE9duit",PROTECTIVE_STOP:"Arr\xEAt de protection",SAFEGUARD_STOP:"Arr\xEAt de s\xE9curit\xE9",EMERGENCY_STOP:"Arr\xEAt d'urgence",SYSTEM_EMERGENCY_STOP:"Arr\xEAt d'urgence syst\xE8me",ROBOT_EMERGENCY_STOP:"Arr\xEAt d'urgence du robot",RECOVERY:"R\xE9cup\xE9ration",VIOLATION:"Violation de s\xE9curit\xE9",FAULT:"D\xE9faut",AUTOMATIC_MODE_SAFEGUARD_STOP:"Arr\xEAt de s\xE9curit\xE9 en mode automatique",SYSTEM_THREE_POSITION_ENABLING_STOP:"Arr\xEAt de validation \xE0 trois positions"},robotMode:{POWER_OFF:"Hors tension",POWER_ON:"Sous tension",IDLE:"Inactif",BACKDRIVE:"D\xE9placement manuel",RUNNING:"En cours",BOOTING:"D\xE9marrage",CONFIRM_SAFETY:"Confirmer la s\xE9curit\xE9",DISCONNECTED:"D\xE9connect\xE9",NO_CONTROLLER:"Aucun contr\xF4leur"},programState:{STOPPED:"Arr\xEAt\xE9",PLAYING:"En cours",PAUSED:"En pause"},viewReset:"R\xE9initialiser la vue",viewIso:"Isom\xE9trique",viewFront:"Face",viewSide:"C\xF4t\xE9",viewTop:"Dessus",identity:(i,e)=>`Robot  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"Approbation en attente",canvasLabel:"Vue 3D du jumeau num\xE9rique du robot ; les fl\xE8ches changent la vue",hudLabel:"Mesures du robot en direct",layerReach:"Port\xE9e",layerBase:"Rep\xE8re de base",layerForce:"Effort",screenshot:"Capture",screenshotLabel:"Exporter une capture avec filigrane",trajectoryClear:"Effacer la trajectoire",trajectoryPause:"Mettre la trajectoire en pause",trajectoryResume:"Reprendre l'enregistrement",trajectoryExport:"Exporter la trajectoire",dockLabel:"Jumeau num\xE9rique UR de Nonead",dockDescription:"Vue en direct du jumeau du robot",dockCollapse:"Replier"},wp={statusDisconnected:"Roboter nicht verbunden",statusLoading:"Verbunden \xB7 Modell wird geladen\u2026",statusConnected:"Verbunden",statusFallbackSuffix:" (kein eingebautes Modell, vereinfachte Geometrie wird verwendet)",statusErrorPrefix:"Darstellungsfehler: ",statusLoadFailed:"Modell konnte nicht geladen werden: ",statusNoWebgl:"WebGL ist hier nicht verf\xFCgbar: auf reinen Zahlenmodus umgeschaltet (Gelenkwinkel und TCP werden weiter aktualisiert)",statusIncomplete:"Der Roboter hat keinen vollst\xE4ndigen Satz Gelenkwinkel zur\xFCckgegeben",statusContextLost:"3D-Kontext verloren (GPU-Reset) \u2014 Panel einklappen und erneut \xF6ffnen, um ihn wiederherzustellen",statusSafetyHint:"Der Roboter wurde m\xF6glicherweise gestoppt; pr\xFCfen Sie das Teach-Pendant",disconnectNeverConnected:"Roboter nicht verbunden: ur_connect war noch nie erfolgreich",disconnectReason:i=>`Roboter nicht verbunden${i?`: ${i}`:""}`,disconnectAmbiguous:i=>`Es ist mehr als ein Roboter verbunden; geben Sie die Roboter-IP an${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (Kandidaten: ${i.join(", ")})`:"",disconnectWorkerDown:i=>`Der UR-Steuerprozess ist nicht verf\xFCgbar${i?`: ${i}`:""} (f\xFChren Sie ur_ping aus, um die Python-Abh\xE4ngigkeiten zu pr\xFCfen)`,disconnectReadFailed:i=>`Roboterstatus konnte nicht gelesen werden${i?`: ${i}`:""}`,jointsPrefix:"Gelenkwinkel (\xB0)",tcpPrefix:"TCP (m / Achsenwinkel rad)",queryFailed:"Abfrage fehlgeschlagen",detailStatusFailed:i=>`Statusabfrage fehlgeschlagen: ${i}`,detailSafety:i=>`Sicherheit ${i}`,detailRobotMode:i=>`Modus ${i}`,detailProgram:i=>`Programm ${i}`,detailSpeed:i=>`Geschwindigkeit ${i}`,detailRunning:"L\xE4uft",detailTempsPrefix:"Temp (\xB0C)",detailTemps:i=>`Temp (\xB0C)  ${i}`,detailBus:(i,e)=>`Bus ${i} V  ${e} A`,overLimit:i=>`\u26A0 \xFCber Grenzwert ${i}`,feedStale:"Die Daten werden nicht mehr aktualisiert",feedRetrying:"Datenkanal wird neu verbunden\u2026",feedRetryWord:"erneuter Versuch",feedNoEventSource:"EventSource ist hier nicht verf\xFCgbar",feedFrames:(i,e)=>` (${i} Frames${e>0?`, ${e} fehlgeschlagen`:""})`,safetyMode:{NORMAL:"Normal",REDUCED:"Reduziert",PROTECTIVE_STOP:"Schutzstopp",SAFEGUARD_STOP:"Sicherheitsstopp",EMERGENCY_STOP:"Not-Halt",SYSTEM_EMERGENCY_STOP:"System-Not-Halt",ROBOT_EMERGENCY_STOP:"Roboter-Not-Halt",RECOVERY:"Wiederherstellung",VIOLATION:"Sicherheitsverletzung",FAULT:"St\xF6rung",AUTOMATIC_MODE_SAFEGUARD_STOP:"Sicherheitsstopp im Automatikmodus",SYSTEM_THREE_POSITION_ENABLING_STOP:"Drei-Stellungen-Freigabestopp"},robotMode:{POWER_OFF:"Ausgeschaltet",POWER_ON:"Eingeschaltet",IDLE:"Leerlauf",BACKDRIVE:"Handf\xFChrung",RUNNING:"L\xE4uft",BOOTING:"Startet",CONFIRM_SAFETY:"Sicherheit best\xE4tigen",DISCONNECTED:"Nicht verbunden",NO_CONTROLLER:"Keine Steuerung"},programState:{STOPPED:"Gestoppt",PLAYING:"L\xE4uft",PAUSED:"Pausiert"},viewReset:"Ansicht zur\xFCcksetzen",viewIso:"Isometrisch",viewFront:"Vorne",viewSide:"Seite",viewTop:"Oben",identity:(i,e)=>`Roboter  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"Freigabe ausstehend",canvasLabel:"3D-Ansicht des digitalen Zwillings; Pfeiltasten wechseln die Ansicht",hudLabel:"Live-Messwerte des Roboters",layerReach:"Reichweite",layerBase:"Basiskoordinatensystem",layerForce:"Kraft",screenshot:"Screenshot",screenshotLabel:"Screenshot mit Wasserzeichen exportieren",trajectoryClear:"Bahn l\xF6schen",trajectoryPause:"Bahn pausieren",trajectoryResume:"Aufzeichnung fortsetzen",trajectoryExport:"Bahn exportieren",dockLabel:"Nonead UR digitaler Zwilling",dockDescription:"Live-Ansicht des Roboter-Zwillings",dockCollapse:"Einklappen"},Rp={statusDisconnected:"\u0420\u043E\u0431\u043E\u0442 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D",statusLoading:"\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \xB7 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u043C\u043E\u0434\u0435\u043B\u0438\u2026",statusConnected:"\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E",statusFallbackSuffix:" (\u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u043E\u0439 \u043C\u043E\u0434\u0435\u043B\u0438 \u043D\u0435\u0442, \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u043F\u0440\u0438\u0431\u043B\u0438\u0436\u0451\u043D\u043D\u0430\u044F \u0433\u0435\u043E\u043C\u0435\u0442\u0440\u0438\u044F)",statusErrorPrefix:"\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438: ",statusLoadFailed:"\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043C\u043E\u0434\u0435\u043B\u044C: ",statusNoWebgl:"WebGL \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: \u0432\u043A\u043B\u044E\u0447\u0451\u043D \u0440\u0435\u0436\u0438\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0438\u0441\u043B\u043E\u0432\u044B\u0445 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0439 (\u0443\u0433\u043B\u044B \u0441\u043E\u0447\u043B\u0435\u043D\u0435\u043D\u0438\u0439 \u0438 TCP \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u044E\u0442 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0442\u044C\u0441\u044F)",statusIncomplete:"\u0420\u043E\u0431\u043E\u0442 \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u043B \u043F\u043E\u043B\u043D\u044B\u0439 \u043D\u0430\u0431\u043E\u0440 \u0443\u0433\u043B\u043E\u0432 \u0441\u043E\u0447\u043B\u0435\u043D\u0435\u043D\u0438\u0439",statusContextLost:"\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 3D \u043F\u043E\u0442\u0435\u0440\u044F\u043D (\u0441\u0431\u0440\u043E\u0441 GPU) \u2014 \u0441\u0432\u0435\u0440\u043D\u0438\u0442\u0435 \u0438 \u0441\u043D\u043E\u0432\u0430 \u0440\u0430\u0437\u0432\u0435\u0440\u043D\u0438\u0442\u0435 \u043F\u0430\u043D\u0435\u043B\u044C, \u0447\u0442\u043E\u0431\u044B \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C",statusSafetyHint:"\u0412\u043E\u0437\u043C\u043E\u0436\u043D\u043E, \u0440\u043E\u0431\u043E\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D; \u043F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u0443\u043B\u044C\u0442 \u043E\u0431\u0443\u0447\u0435\u043D\u0438\u044F",disconnectNeverConnected:"\u0420\u043E\u0431\u043E\u0442 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D: ur_connect \u0435\u0449\u0451 \u043D\u0438 \u0440\u0430\u0437\u0443 \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0430\u043B\u0441\u044F \u0443\u0441\u043F\u0435\u0448\u043D\u043E",disconnectReason:i=>`\u0420\u043E\u0431\u043E\u0442 \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D${i?`: ${i}`:""}`,disconnectAmbiguous:i=>`\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0440\u043E\u0431\u043E\u0442\u043E\u0432; \u0443\u043A\u0430\u0436\u0438\u0442\u0435 IP-\u0430\u0434\u0440\u0435\u0441 \u0440\u043E\u0431\u043E\u0442\u0430${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (\u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442\u044B: ${i.join(", ")})`:"",disconnectWorkerDown:i=>`\u041F\u0440\u043E\u0446\u0435\u0441\u0441 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044F UR \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D${i?`: ${i}`:""} (\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435 ur_ping, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0438 Python)`,disconnectReadFailed:i=>`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0440\u043E\u0431\u043E\u0442\u0430${i?`: ${i}`:""}`,jointsPrefix:"\u0423\u0433\u043B\u044B \u0441\u043E\u0447\u043B\u0435\u043D\u0435\u043D\u0438\u0439 (\xB0)",tcpPrefix:"TCP (\u043C / \u0440\u0430\u0434 \u043E\u0441\u0438-\u0443\u0433\u043B\u0430)",queryFailed:"\u0437\u0430\u043F\u0440\u043E\u0441 \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D",detailStatusFailed:i=>`\u0417\u0430\u043F\u0440\u043E\u0441 \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D: ${i}`,detailSafety:i=>`\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C: ${i}`,detailRobotMode:i=>`\u0420\u0435\u0436\u0438\u043C: ${i}`,detailProgram:i=>`\u041F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430: ${i}`,detailSpeed:i=>`\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C: ${i}`,detailRunning:"\u0412\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",detailTempsPrefix:"\u0422\u0435\u043C\u043F. (\xB0C)",detailTemps:i=>`\u0422\u0435\u043C\u043F. (\xB0C)  ${i}`,detailBus:(i,e)=>`\u0428\u0438\u043D\u0430 ${i} \u0412  ${e} \u0410`,overLimit:i=>`\u26A0 \u0437\u0430 \u043F\u0440\u0435\u0434\u0435\u043B\u043E\u043C ${i}`,feedStale:"\u0414\u0430\u043D\u043D\u044B\u0435 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043B\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0442\u044C\u0441\u044F",feedRetrying:"\u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A\u0430\u043D\u0430\u043B\u0430 \u0434\u0430\u043D\u043D\u044B\u0445\u2026",feedRetryWord:"\u043F\u043E\u0432\u0442\u043E\u0440\u043D\u0430\u044F \u043F\u043E\u043F\u044B\u0442\u043A\u0430",feedNoEventSource:"EventSource \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D",feedFrames:(i,e)=>` (\u043A\u0430\u0434\u0440\u043E\u0432: ${i}${e>0?`, \u043E\u0448\u0438\u0431\u043E\u043A: ${e}`:""})`,safetyMode:{NORMAL:"\u041D\u043E\u0440\u043C\u0430",REDUCED:"\u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C",PROTECTIVE_STOP:"\u0417\u0430\u0449\u0438\u0442\u043D\u0430\u044F \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430",SAFEGUARD_STOP:"\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u043F\u043E \u0437\u0430\u0449\u0438\u0442\u0435",EMERGENCY_STOP:"\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u043D\u043E\u0432",SYSTEM_EMERGENCY_STOP:"\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u043D\u043E\u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u044B",ROBOT_EMERGENCY_STOP:"\u0410\u0432\u0430\u0440\u0438\u0439\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u043D\u043E\u0432 \u0440\u043E\u0431\u043E\u0442\u0430",RECOVERY:"\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435",VIOLATION:"\u041D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0435 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438",FAULT:"\u041D\u0435\u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E\u0441\u0442\u044C",AUTOMATIC_MODE_SAFEGUARD_STOP:"\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u043F\u043E \u0437\u0430\u0449\u0438\u0442\u0435 \u0432 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435",SYSTEM_THREE_POSITION_ENABLING_STOP:"\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0442\u0440\u0451\u0445\u043F\u043E\u0437\u0438\u0446\u0438\u043E\u043D\u043D\u043E\u0433\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F"},robotMode:{POWER_OFF:"\u041F\u0438\u0442\u0430\u043D\u0438\u0435 \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u043E",POWER_ON:"\u041F\u0438\u0442\u0430\u043D\u0438\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E",IDLE:"\u041F\u0440\u043E\u0441\u0442\u043E\u0439",BACKDRIVE:"\u0420\u0443\u0447\u043D\u043E\u0435 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u0435",RUNNING:"\u0412\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",BOOTING:"\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430",CONFIRM_SAFETY:"\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C",DISCONNECTED:"\u041D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D",NO_CONTROLLER:"\u041D\u0435\u0442 \u043A\u043E\u043D\u0442\u0440\u043E\u043B\u043B\u0435\u0440\u0430"},programState:{STOPPED:"\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430",PLAYING:"\u0412\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",PAUSED:"\u041F\u0430\u0443\u0437\u0430"},viewReset:"\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u0438\u0434",viewIso:"\u0418\u0437\u043E\u043C\u0435\u0442\u0440\u0438\u044F",viewFront:"\u0421\u043F\u0435\u0440\u0435\u0434\u0438",viewSide:"\u0421\u0431\u043E\u043A\u0443",viewTop:"\u0421\u0432\u0435\u0440\u0445\u0443",identity:(i,e)=>`\u0420\u043E\u0431\u043E\u0442  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"\u041E\u0436\u0438\u0434\u0430\u0435\u0442 \u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0438\u044F",canvasLabel:"3D-\u0432\u0438\u0434 \u0446\u0438\u0444\u0440\u043E\u0432\u043E\u0433\u043E \u0434\u0432\u043E\u0439\u043D\u0438\u043A\u0430 \u0440\u043E\u0431\u043E\u0442\u0430; \u0441\u0442\u0440\u0435\u043B\u043A\u0438 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u044E\u0442 \u0432\u0438\u0434",hudLabel:"\u041F\u043E\u043A\u0430\u0437\u0430\u043D\u0438\u044F \u0440\u043E\u0431\u043E\u0442\u0430 \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438",layerReach:"\u0417\u043E\u043D\u0430 \u0434\u043E\u0441\u044F\u0433\u0430\u0435\u043C\u043E\u0441\u0442\u0438",layerBase:"\u0411\u0430\u0437\u043E\u0432\u0430\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430",layerForce:"\u0421\u0438\u043B\u0430",screenshot:"\u0421\u043D\u0438\u043C\u043E\u043A",screenshotLabel:"\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \u0441\u043D\u0438\u043C\u043A\u0430 \u0441 \u0432\u043E\u0434\u044F\u043D\u044B\u043C \u0437\u043D\u0430\u043A\u043E\u043C",trajectoryClear:"\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u044E",trajectoryPause:"\u041F\u0430\u0443\u0437\u0430 \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u0438",trajectoryResume:"\u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C",trajectoryExport:"\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \u0442\u0440\u0430\u0435\u043A\u0442\u043E\u0440\u0438\u0438",dockLabel:"\u0426\u0438\u0444\u0440\u043E\u0432\u043E\u0439 \u0434\u0432\u043E\u0439\u043D\u0438\u043A UR Nonead",dockDescription:"\u0412\u0438\u0434 \u0434\u0432\u043E\u0439\u043D\u0438\u043A\u0430 \u0440\u043E\u0431\u043E\u0442\u0430 \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438",dockCollapse:"\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C"},Cp={statusDisconnected:"Rob\xF4 n\xE3o conectado",statusLoading:"Conectado \xB7 carregando modelo\u2026",statusConnected:"Conectado",statusFallbackSuffix:" (sem modelo embutido; usando geometria aproximada)",statusErrorPrefix:"Erro de renderiza\xE7\xE3o: ",statusLoadFailed:"Falha ao carregar o modelo: ",statusNoWebgl:"WebGL n\xE3o est\xE1 dispon\xEDvel aqui: alternado para o modo somente num\xE9rico (os \xE2ngulos das juntas e o TCP continuam sendo atualizados)",statusIncomplete:"O rob\xF4 n\xE3o retornou o conjunto completo de \xE2ngulos das juntas",statusContextLost:"Contexto 3D perdido (rein\xEDcio da GPU) \u2014 recolha e reabra o painel para recuperar",statusSafetyHint:"O rob\xF4 pode ter parado; verifique o teach pendant",disconnectNeverConnected:"Rob\xF4 n\xE3o conectado: o ur_connect nunca foi executado com sucesso",disconnectReason:i=>`Rob\xF4 n\xE3o conectado${i?`: ${i}`:""}`,disconnectAmbiguous:i=>`H\xE1 mais de um rob\xF4 conectado; informe o IP do rob\xF4${i}`,disconnectCandidates:i=>Array.isArray(i)&&i.length>0?` (candidatos: ${i.join(", ")})`:"",disconnectWorkerDown:i=>`O processo de controle UR n\xE3o est\xE1 dispon\xEDvel${i?`: ${i}`:""} (execute ur_ping para verificar as depend\xEAncias do Python)`,disconnectReadFailed:i=>`Falha ao ler o estado do rob\xF4${i?`: ${i}`:""}`,jointsPrefix:"\xC2ngulos das juntas (\xB0)",tcpPrefix:"TCP (m / rad eixo-\xE2ngulo)",queryFailed:"falha na consulta",detailStatusFailed:i=>`Falha na consulta de estado: ${i}`,detailSafety:i=>`Seguran\xE7a ${i}`,detailRobotMode:i=>`Modo ${i}`,detailProgram:i=>`Programa ${i}`,detailSpeed:i=>`Velocidade ${i}`,detailRunning:"Em execu\xE7\xE3o",detailTempsPrefix:"Temp (\xB0C)",detailTemps:i=>`Temp (\xB0C)  ${i}`,detailBus:(i,e)=>`Barramento ${i} V  ${e} A`,overLimit:i=>`\u26A0 acima do limite ${i}`,feedStale:"Os dados pararam de ser atualizados",feedRetrying:"Reconectando o canal de dados\u2026",feedRetryWord:"tentando novamente",feedNoEventSource:"EventSource n\xE3o est\xE1 dispon\xEDvel aqui",feedFrames:(i,e)=>` (${i} quadros${e>0?`, ${e} com erro`:""})`,safetyMode:{NORMAL:"Normal",REDUCED:"Reduzido",PROTECTIVE_STOP:"Parada de prote\xE7\xE3o",SAFEGUARD_STOP:"Parada de salvaguarda",EMERGENCY_STOP:"Parada de emerg\xEAncia",SYSTEM_EMERGENCY_STOP:"Parada de emerg\xEAncia do sistema",ROBOT_EMERGENCY_STOP:"Parada de emerg\xEAncia do rob\xF4",RECOVERY:"Recupera\xE7\xE3o",VIOLATION:"Viola\xE7\xE3o de seguran\xE7a",FAULT:"Falha",AUTOMATIC_MODE_SAFEGUARD_STOP:"Parada de salvaguarda em modo autom\xE1tico",SYSTEM_THREE_POSITION_ENABLING_STOP:"Parada de habilita\xE7\xE3o de tr\xEAs posi\xE7\xF5es"},robotMode:{POWER_OFF:"Desligado",POWER_ON:"Ligado",IDLE:"Ocioso",BACKDRIVE:"Arraste manual",RUNNING:"Em execu\xE7\xE3o",BOOTING:"Inicializando",CONFIRM_SAFETY:"Confirmar seguran\xE7a",DISCONNECTED:"Desconectado",NO_CONTROLLER:"Sem controlador"},programState:{STOPPED:"Parado",PLAYING:"Em execu\xE7\xE3o",PAUSED:"Pausado"},viewReset:"Redefinir vis\xE3o",viewIso:"Isom\xE9trica",viewFront:"Frontal",viewSide:"Lateral",viewTop:"Superior",identity:(i,e)=>`Rob\xF4  ${[i,e].filter(Boolean).join("  \xB7  ")}`,pendingPrefix:"Aguardando aprova\xE7\xE3o",canvasLabel:"Vis\xE3o 3D do g\xEAmeo digital do rob\xF4; as setas alternam a vis\xE3o",hudLabel:"Leituras do rob\xF4 ao vivo",layerReach:"Alcance",layerBase:"Sistema base",layerForce:"For\xE7a",screenshot:"Captura",screenshotLabel:"Exportar uma captura com marca d\u2019\xE1gua",trajectoryClear:"Limpar trajet\xF3ria",trajectoryPause:"Pausar trajet\xF3ria",trajectoryResume:"Retomar grava\xE7\xE3o",trajectoryExport:"Exportar trajet\xF3ria",dockLabel:"G\xEAmeo digital UR Nonead",dockDescription:"Vis\xE3o ao vivo do g\xEAmeo do rob\xF4",dockCollapse:"Recolher"},$i=Object.freeze({zh:Mp,en:bp,ja:Tp,es:Ep,fr:Ap,de:wp,ru:Rp,pt:Cp}),Ml=Object.freeze(["zh","en","ja","es","fr","de","ru","pt"]),Ws="zh",bS=Object.freeze({zh:"\u7B80\u4F53\u4E2D\u6587",en:"English",ja:"\u65E5\u672C\u8A9E",es:"Espa\xF1ol",fr:"Fran\xE7ais",de:"Deutsch",ru:"\u0420\u0443\u0441\u0441\u043A\u0438\u0439",pt:"Portugu\xEAs (Brasil)"});function Ip(i){let e=Array.isArray(i)?i[0]:i;if(typeof e!="string"||e.trim()==="")return Ws;let t=e.trim().toLowerCase().split(/[-_]/u)[0];return Ml.includes(t)?t:Ws}function vl(i){return $i[Ip(i)]??$i[Ws]}function Pp(i){let e=i??globalThis.navigator;if(!e)return $i[Ws];if(typeof e.locale=="string"&&e.locale.trim()!=="")return vl(e.locale);let t=Array.isArray(e.languages)?e.languages.filter(n=>typeof n=="string"&&n.trim()!==""):[];for(let n of t){let s=n.trim().toLowerCase().split(/[-_]/u)[0];if(Ml.includes(s))return $i[s]}return vl(e.language)}function bl(i){if(!(i===null||typeof i!="object")){try{if(typeof i.get=="function"){let e=i.get("locale");if(e)return e}}catch{}try{return i.locale??void 0}catch{return}}}function Lp(i,e="ur-twin"){let t=bl(i);if(!t||typeof t.register!="function")return!1;try{return t.register(e,$i),!0}catch(n){return i?.logger?.warn?.(`[ur-twin] locale.register \u5931\u8D25\uFF0C\u56DE\u9000\u672C\u5730\u6587\u6848\u8868\uFF1A${n?.message??n}`),!1}}function Dp(i){let e=bl(i);if(e)try{let t=typeof e.getSnapshot=="function"?e.getSnapshot():void 0,n=t?.locale??t?.current??t?.active;return typeof n=="string"&&n.trim()!==""?n:void 0}catch{return}}var Qr,Sl=new Set;function Yu(i){return typeof i!="function"?()=>{}:(Sl.add(i),()=>{Sl.delete(i)})}function Np(){for(let i of[...Sl])try{i(Qr)}catch{}}function yl(i){let e=typeof i=="string"&&i.trim()!==""?i:void 0;e!==Qr&&(Qr=e,Np())}function Tn(i){let e=()=>Pp(i??{locale:Qr,...globalThis.navigator}),t=new Map,n=o=>{let a=vl(o);t.has(o)||t.set(o,new Map);let c=t.get(o),l=u=>new Proxy(u,{get(h,d,p){let g=Reflect.get(h,d,p);return g&&typeof g=="object"&&!Array.isArray(g)?(c.has(d)||c.set(d,l(g)),c.get(d)):g}});return l(a)},s,r;return new Proxy({},{get(o,a){let c=e(),l=Op(c);return(l!==s||r===void 0)&&(s=l,r=n(l)),Reflect.get(r,a)},has(o,a){return Reflect.has(e(),a)},ownKeys(){return Reflect.ownKeys(e())},getOwnPropertyDescriptor(o,a){return Reflect.getOwnPropertyDescriptor(e(),a)}})}function Op(i){for(let e of Ml)if($i[e]===i)return e;return Ws}function eo(i){return new Proxy({},{get(e,t){let n=Tn()[i];return n===void 0?void 0:Reflect.get(n,t)},has(e,t){let n=Tn()[i];return n===void 0?!1:Reflect.has(n,t)},ownKeys(){let e=Tn()[i];return e===void 0?[]:Reflect.ownKeys(e)},getOwnPropertyDescriptor(e,t){let n=Tn()[i];return n===void 0?void 0:Reflect.getOwnPropertyDescriptor(n,t)}})}function qu(i,e="ur-twin"){Lp(i,e),yl(Dp(i));let t=r=>{typeof r=="string"&&r.trim()!==""&&yl(r)},n=[],s=bl(i);if(typeof s?.subscribe=="function")try{let r=s.subscribe(o=>{let a=o?.active??o?.locale??o?.current;typeof a=="string"&&t(a)});typeof r=="function"&&n.push(r)}catch{}if(typeof i?.on=="function")try{let r=i.on("locale/change",o=>{let a=o?.active??o?.locale??o?.current;typeof a=="string"&&t(a)});typeof r=="function"&&n.push(r)}catch{}return()=>{for(let r of n)try{r()}catch{}yl(void 0)}}var Up="[data-sidebar-right-guide]",Tl="[data-sidebar-right-guide-entry]",Fp="[data-sidebar-right-tab]",ju="data-dsh-ur-twin-right-entry",wS=`[${ju}]`,Bp="data-dsh-ur-twin-right-view",zp="data-dsh-ur-twin-right-close",kp="data-dsh-ur-twin-right-panel",It=Tn(),RS=It.dockLabel,CS=It.dockDescription,IS=It.dockLabel,Ku='<svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#539CFA" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5V6.2l5-2.7 5 2.7v4.3"/><circle cx="8" cy="4.6" r="1.4"/><path d="M5.6 13.2 6.9 9.4M10.4 13.2 9.1 9.4M6.9 9.4h2.2"/></svg>',Hp={boxSizing:"border-box",display:"flex",alignItems:"center",gap:"14px",width:"100%",padding:"14px 20px",border:"0.8px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12))",borderRadius:"20px",background:"var(--dsw-alias-bg-layer-1, #ffffff)",color:"var(--dsw-alias-label-primary, #0f1115)",cursor:"pointer",font:"inherit",textAlign:"left"},Vp={display:"inline-flex",alignItems:"center",justifyContent:"center",flex:"none"},Gp={display:"flex",flexDirection:"column",gap:"2px",minWidth:"0"},Wp={fontSize:"14px",fontWeight:"500",lineHeight:"20px"},Xp={fontSize:"12px",lineHeight:"18px",color:"var(--dsw-alias-label-tertiary, #6b7280)"},Yp={boxSizing:"border-box",position:"relative",flex:"1 1 auto",minWidth:"0",minHeight:"0",display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--dsw-alias-bg-base, #0d1117)"},qp={boxSizing:"border-box",display:"flex",alignItems:"center",gap:"8px",flex:"0 0 auto",padding:"8px 12px",borderBottom:"1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.24))",color:"var(--dsw-alias-label-primary, #e6edf3)",fontSize:"13px",fontWeight:"600"},$p={flex:"1 1 auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},jp={flex:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",width:"22px",height:"22px",padding:"0",border:"none",borderRadius:"6px",background:"transparent",color:"inherit",cursor:"pointer",font:"inherit",fontSize:"13px",lineHeight:"1"},Kp={position:"relative",flex:"1 1 auto",minHeight:"0",overflow:"hidden"},Zp={boxShadow:"inset 0 0 0 1.5px var(--dsw-alias-brand-primary, #539CFA)"};function Jp(){return typeof globalThis>"u"?void 0:globalThis}function Jt(i,e){if(!(!i||!i.style))for(let t of Object.keys(e))i.style[t]=e[t]}function $u(i){return i?typeof i.isConnected=="boolean"?i.isConnected:i.parentElement!==null&&i.parentElement!==void 0:!1}function Qp(i){let e=i.querySelector(Tl);if(!e||typeof e.cloneNode!="function")return;let t;try{t=e.cloneNode(!0)}catch{return}if(!t||typeof t.querySelector!="function")return;for(let o of[...t.children??[]]){let a=String(o?.className??"");if(!/entryIcon|entryText|entryMain|cardIcon|cardText|cardMain/i.test(a))try{o.remove?.()}catch{}}let n=t.querySelector('[class*="entryIcon"], [class*="cardIcon"]');n&&(n.innerHTML=Ku);let s=t.querySelector('[class*="entryTitle"], [class*="cardTitle"]');s&&(s.textContent=It.dockLabel);let r=t.querySelector('[class*="entryDescription"], [class*="cardDesc"]');return r&&(r.textContent=It.dockDescription),t.removeAttribute?.("data-sidebar-right-guide-entry"),t.removeAttribute?.("aria-keyshortcuts"),typeof t.className=="string"&&t.className.trim()===""&&(t.className="dsh-ur-twin-right-entry"),t}function em(i){let e=i.createElement("button");e.setAttribute("type","button"),typeof e.className=="string"&&(e.className="dsh-ur-twin-right-entry"),Jt(e,Hp);let t=i.createElement("span");t.setAttribute("aria-hidden","true"),t.innerHTML=Ku,Jt(t,Vp);let n=i.createElement("span");Jt(n,Gp);let s=i.createElement("span");s.textContent=It.dockLabel,Jt(s,Wp);let r=i.createElement("span");return r.textContent=It.dockDescription,Jt(r,Xp),n.appendChild(s),n.appendChild(r),e.appendChild(t),e.appendChild(n),e}function Zu(i){if(!i||typeof i.querySelector!="function")return;let e=i.querySelector('[class*="entryTitle"], [class*="cardTitle"]');e&&(e.textContent=It.dockLabel);let t=i.querySelector('[class*="entryDescription"], [class*="cardDesc"]');t&&(t.textContent=It.dockDescription),i.setAttribute?.("aria-label",It.dockLabel),i.setAttribute?.("title",It.dockLabel)}function tm(i){let e=Qp(i),t=e??em(i);return t.setAttribute(ju,""),t.setAttribute("data-dsh-plugin","ur-digital-twin"),t.setAttribute("aria-pressed","false"),Zu(t),{element:t,cloned:e!==void 0}}function Ju({doc:i=Jp()?.document,onToggle:e,mountPanel:t,MutationObserver:n,raf:s,caf:r}={}){if(!i||typeof i.createElement!="function"||typeof i.querySelector!="function")return{dispose(){},isActive:()=>!1,toggle(){},setActive(){}};let o={MutationObserver:n,raf:s,caf:r},a=!1,c=!1,l,u=!1,h,d,p,g,x,m,f,T=()=>{},b=()=>{},M=()=>i.querySelector(Up),A=re=>{if(!re.hasAttribute?.("data-dsh-guide-grid"))return re;let ae=re.children?.[0];return!ae||ae.hasAttribute?.("data-sidebar-right-guide-entry")?re:ae},E=re=>{let ae=A(re),Re=(re.querySelector?.("[data-guide-more]")??ae.querySelector?.("[data-guide-more]"))?.parentElement;return Re&&typeof Re.parentElement?.insertBefore=="function"?{container:Re.parentElement,before:Re}:{container:ae}},C=()=>{if(a)return;let re=M();if(!re||typeof re.appendChild!="function")return;let{container:ae,before:Oe}=E(re),Re=i.querySelector(Tl),G=Re!==null&&typeof Re.cloneNode=="function",K=l!==void 0&&!u&&G;if(l!==void 0&&$u(l)&&!K){let de=ae.children||[],Ce=de.indexOf(l),_e=Oe?de.indexOf(Oe):-1;(Oe&&l.parentNode===ae&&Ce>_e||Oe&&l.parentNode!==ae)&&ae.insertBefore(l,Oe);return}if(K){try{l.removeEventListener?.("click",V)}catch{}try{l.remove?.()}catch{}l=void 0}if(l===void 0){let de=tm(i);l=de.element,u=de.cloned,l.addEventListener("click",V)}q(),Oe?ae.insertBefore(l,Oe):ae.appendChild(l)},D=()=>{let re=M();!re||m===re||(S(),m=re,f=re.style?.display??"",Jt(re,{display:"none"}))},S=()=>{m&&(Jt(m,{display:f??""}),m=void 0,f=void 0)},y=()=>{let re=M();if(!re||typeof re.closest!="function")return;let ae;try{ae=re.closest(Fp)}catch{return}return ae&&typeof ae.appendChild=="function"?ae:void 0},P=()=>{let re=i.createElement("div");re.setAttribute(Bp,""),re.setAttribute("data-dsh-plugin","ur-digital-twin"),Jt(re,Yp);let ae=i.createElement("div");Jt(ae,qp);let Oe=i.createElement("span");Oe.textContent=It.dockLabel,Jt(Oe,$p);let Re=i.createElement("button");Re.setAttribute("type","button"),Re.setAttribute(zp,""),Re.setAttribute("aria-label",It.dockCollapse),Re.setAttribute("title",It.dockCollapse),Re.textContent="\u2715",Jt(Re,jp),Re.addEventListener("click",oe),ae.appendChild(Oe),ae.appendChild(Re);let G=i.createElement("div");return G.setAttribute(kp,""),Jt(G,Kp),re.appendChild(ae),re.appendChild(G),d=Oe,p=Re,g=G,re},F=()=>{d&&(d.textContent=It.dockLabel),p&&(p.setAttribute("aria-label",It.dockCollapse),p.setAttribute("title",It.dockCollapse))},k=()=>{if(x){try{x.dispose?.()}catch{}x=void 0}if(h){try{h.remove?.()}catch{}h=void 0}d=void 0,p=void 0,g=void 0,S()},H=()=>{if(!(a||!c)){if(h&&!$u(h)&&k(),!h){let re=y();if(!re)return;h=P(),re.appendChild(h),D()}if(D(),!(x||typeof t!="function"||!g))try{x=t(g)??void 0}catch{x=void 0}}},q=()=>{l&&(l.setAttribute("aria-pressed",c?"true":"false"),c?l.setAttribute("data-active",""):l.removeAttribute("data-active"),Jt(l,c?Zp:{boxShadow:""}))},W=re=>{if(a)return;let ae=re===!0;if(ae===c){ae&&H();return}if(c=ae,q(),c?H():k(),typeof e=="function")try{e(c)}catch{}},te=()=>W(!c);function V(re){re?.preventDefault?.(),te()}function oe(re){re?.preventDefault?.(),W(!1)}let ce=re=>{if(a||!c)return;let ae=re?.target;if(!ae||typeof ae.closest!="function"||ae===l||l?.contains?.(ae))return;let Oe=null;try{Oe=ae.closest(Tl)}catch{Oe=null}Oe&&W(!1)},Te=()=>{a||(C(),Zu(l),F(),c&&(M()===null||M()===void 0?W(!1):H()))};return i.addEventListener?.("click",ce,!0),T=Xu(i,o,Te),b=Yu(Te),C(),{isActive:()=>c,toggle:te,setActive:W,dispose(){if(!a){a=!0;try{T()}catch{}T=()=>{};try{b()}catch{}b=()=>{};try{i.removeEventListener?.("click",ce,!0)}catch{}try{l?.removeEventListener?.("click",V)}catch{}k();try{l?.remove?.()}catch{}l=void 0,c=!1}}}}var ui={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},hi={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Bh=0,hc=1,zh=2;var dc=1,kh=2,Nn=3,xn=0,Et=1,Bt=2,Kn=0,Si=1,fc=2,pc=3,mc=4,Hh=5,ri=100,Vh=101,Gh=102,Wh=103,Xh=104,Yh=200,qh=201,$h=202,jh=203,Po=204,Lo=205,Kh=206,Zh=207,Jh=208,Qh=209,ed=210,td=211,nd=212,id=213,sd=214,Jo=0,Qo=1,ea=2,Mi=3,ta=4,na=5,ia=6,sa=7,ra=0,rd=1,od=2,Zn=0,ad=1,ld=2,cd=3,oa=4,ud=5,hd=6,dd=7,ec="attached",fd="detached",gc=300,Oi=301,Ui=302,aa=303,la=304,Or=306,oi=1e3,En=1001,ps=1002,Pt=1003,ca=1004;var Fi=1005;var Vt=1006,As=1007;var Sn=1008;var Mn=1009,_c=1010,xc=1011,ws=1012,ua=1013,di=1014,un=1015,Rs=1016,ha=1017,da=1018,Cs=1020,yc=35902,vc=35899,Sc=1021,Mc=1022,tn=1023,ms=1026,Is=1027,fa=1028,pa=1029,bc=1030,ma=1031;var ga=1033,Ur=33776,Fr=33777,Br=33778,zr=33779,_a=35840,xa=35841,ya=35842,va=35843,Sa=36196,Ma=37492,ba=37496,Ta=37808,Ea=37809,Aa=37810,wa=37811,Ra=37812,Ca=37813,Ia=37814,Pa=37815,La=37816,Da=37817,Na=37818,Oa=37819,Ua=37820,Fa=37821,Ba=36492,za=36494,ka=36495,Ha=36283,Va=36284,Ga=36285,Wa=36286;var bi=2300,Ti=2301,Io=2302,tc=2400,nc=2401,ic=2402,pd=2500;var Tc=0,kr=1,Ps=2,md=3200,gd=3201;var Xa=0,_d=1,Jn="",bt="srgb",Lt="srgb-linear",sr="linear",at="srgb";var vi=7680;var sc=519,xd=512,yd=513,vd=514,Ec=515,Sd=516,Md=517,bd=518,Td=519,Do=35044,Ya=35048;var Ac="300 es",gn=2e3,rr=2001;var wn=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let s=n[e];if(s!==void 0){let r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}},Dt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Qu=1234567,nr=Math.PI/180,Ei=180/Math.PI;function _n(){let i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Dt[i&255]+Dt[i>>8&255]+Dt[i>>16&255]+Dt[i>>24&255]+"-"+Dt[e&255]+Dt[e>>8&255]+"-"+Dt[e>>16&15|64]+Dt[e>>24&255]+"-"+Dt[t&63|128]+Dt[t>>8&255]+"-"+Dt[t>>16&255]+Dt[t>>24&255]+Dt[n&255]+Dt[n>>8&255]+Dt[n>>16&255]+Dt[n>>24&255]).toLowerCase()}function Xe(i,e,t){return Math.max(e,Math.min(t,i))}function wc(i,e){return(i%e+e)%e}function nm(i,e,t,n,s){return n+(i-e)*(s-n)/(t-e)}function im(i,e,t){return i!==e?(t-i)/(e-i):0}function ir(i,e,t){return(1-t)*i+t*e}function sm(i,e,t,n){return ir(i,e,1-Math.exp(-t*n))}function rm(i,e=1){return e-Math.abs(wc(i,e*2)-e)}function om(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*(3-2*i))}function am(i,e,t){return i<=e?0:i>=t?1:(i=(i-e)/(t-e),i*i*i*(i*(i*6-15)+10))}function lm(i,e){return i+Math.floor(Math.random()*(e-i+1))}function cm(i,e){return i+Math.random()*(e-i)}function um(i){return i*(.5-Math.random())}function hm(i){i!==void 0&&(Qu=i);let e=Qu+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function dm(i){return i*nr}function fm(i){return i*Ei}function pm(i){return(i&i-1)===0&&i!==0}function mm(i){return Math.pow(2,Math.ceil(Math.log(i)/Math.LN2))}function gm(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function _m(i,e,t,n,s){let r=Math.cos,o=Math.sin,a=r(t/2),c=o(t/2),l=r((e+n)/2),u=o((e+n)/2),h=r((e-n)/2),d=o((e-n)/2),p=r((n-e)/2),g=o((n-e)/2);switch(s){case"XYX":i.set(a*u,c*h,c*d,a*l);break;case"YZY":i.set(c*d,a*u,c*h,a*l);break;case"ZXZ":i.set(c*h,c*d,a*u,a*l);break;case"XZX":i.set(a*u,c*g,c*p,a*l);break;case"YXY":i.set(c*p,a*u,c*g,a*l);break;case"ZYZ":i.set(c*g,c*p,a*u,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+s)}}function mn(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function ot(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}var Hr={DEG2RAD:nr,RAD2DEG:Ei,generateUUID:_n,clamp:Xe,euclideanModulo:wc,mapLinear:nm,inverseLerp:im,lerp:ir,damp:sm,pingpong:rm,smoothstep:om,smootherstep:am,randInt:lm,randFloat:cm,randFloatSpread:um,seededRandom:hm,degToRad:dm,radToDeg:fm,isPowerOfTwo:pm,ceilPowerOfTwo:mm,floorPowerOfTwo:gm,setQuaternionFromProperEuler:_m,normalize:ot,denormalize:mn},we=class i{constructor(e=0,t=0){i.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Xe(this.x,e.x,t.x),this.y=Xe(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Xe(this.x,e,t),this.y=Xe(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Xe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Xe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},Gt=class{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let c=n[s+0],l=n[s+1],u=n[s+2],h=n[s+3],d=r[o+0],p=r[o+1],g=r[o+2],x=r[o+3];if(a===0){e[t+0]=c,e[t+1]=l,e[t+2]=u,e[t+3]=h;return}if(a===1){e[t+0]=d,e[t+1]=p,e[t+2]=g,e[t+3]=x;return}if(h!==x||c!==d||l!==p||u!==g){let m=1-a,f=c*d+l*p+u*g+h*x,T=f>=0?1:-1,b=1-f*f;if(b>Number.EPSILON){let A=Math.sqrt(b),E=Math.atan2(A,f*T);m=Math.sin(m*E)/A,a=Math.sin(a*E)/A}let M=a*T;if(c=c*m+d*M,l=l*m+p*M,u=u*m+g*M,h=h*m+x*M,m===1-a){let A=1/Math.sqrt(c*c+l*l+u*u+h*h);c*=A,l*=A,u*=A,h*=A}}e[t]=c,e[t+1]=l,e[t+2]=u,e[t+3]=h}static multiplyQuaternionsFlat(e,t,n,s,r,o){let a=n[s],c=n[s+1],l=n[s+2],u=n[s+3],h=r[o],d=r[o+1],p=r[o+2],g=r[o+3];return e[t]=a*g+u*h+c*p-l*d,e[t+1]=c*g+u*d+l*h-a*p,e[t+2]=l*g+u*p+a*d-c*h,e[t+3]=u*g-a*h-c*d-l*p,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,c=Math.sin,l=a(n/2),u=a(s/2),h=a(r/2),d=c(n/2),p=c(s/2),g=c(r/2);switch(o){case"XYZ":this._x=d*u*h+l*p*g,this._y=l*p*h-d*u*g,this._z=l*u*g+d*p*h,this._w=l*u*h-d*p*g;break;case"YXZ":this._x=d*u*h+l*p*g,this._y=l*p*h-d*u*g,this._z=l*u*g-d*p*h,this._w=l*u*h+d*p*g;break;case"ZXY":this._x=d*u*h-l*p*g,this._y=l*p*h+d*u*g,this._z=l*u*g+d*p*h,this._w=l*u*h-d*p*g;break;case"ZYX":this._x=d*u*h-l*p*g,this._y=l*p*h+d*u*g,this._z=l*u*g-d*p*h,this._w=l*u*h+d*p*g;break;case"YZX":this._x=d*u*h+l*p*g,this._y=l*p*h+d*u*g,this._z=l*u*g-d*p*h,this._w=l*u*h-d*p*g;break;case"XZY":this._x=d*u*h-l*p*g,this._y=l*p*h-d*u*g,this._z=l*u*g+d*p*h,this._w=l*u*h+d*p*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],c=t[9],l=t[2],u=t[6],h=t[10],d=n+a+h;if(d>0){let p=.5/Math.sqrt(d+1);this._w=.25/p,this._x=(u-c)*p,this._y=(r-l)*p,this._z=(o-s)*p}else if(n>a&&n>h){let p=2*Math.sqrt(1+n-a-h);this._w=(u-c)/p,this._x=.25*p,this._y=(s+o)/p,this._z=(r+l)/p}else if(a>h){let p=2*Math.sqrt(1+a-n-h);this._w=(r-l)/p,this._x=(s+o)/p,this._y=.25*p,this._z=(c+u)/p}else{let p=2*Math.sqrt(1+h-n-a);this._w=(o-s)/p,this._x=(r+l)/p,this._y=(c+u)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Xe(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,c=t._y,l=t._z,u=t._w;return this._x=n*u+o*a+s*l-r*c,this._y=s*u+o*c+r*a-n*l,this._z=r*u+o*l+n*c-s*a,this._w=o*u-n*a-s*c-r*l,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);let n=this._x,s=this._y,r=this._z,o=this._w,a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;let c=1-a*a;if(c<=Number.EPSILON){let p=1-t;return this._w=p*o+t*this._w,this._x=p*n+t*this._x,this._y=p*s+t*this._y,this._z=p*r+t*this._z,this.normalize(),this}let l=Math.sqrt(c),u=Math.atan2(l,a),h=Math.sin((1-t)*u)/l,d=Math.sin(t*u)/l;return this._w=o*h+this._w*d,this._x=n*h+this._x*d,this._y=s*h+this._y*d,this._z=r*h+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),s=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(s*Math.sin(e),s*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},L=class i{constructor(e=0,t=0,n=0){i.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(eh.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(eh.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){let t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,c=e.w,l=2*(o*s-a*n),u=2*(a*t-r*s),h=2*(r*n-o*t);return this.x=t+c*l+o*h-a*u,this.y=n+c*u+a*l-r*h,this.z=s+c*h+r*u-o*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Xe(this.x,e.x,t.x),this.y=Xe(this.y,e.y,t.y),this.z=Xe(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Xe(this.x,e,t),this.y=Xe(this.y,e,t),this.z=Xe(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Xe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,c=t.z;return this.x=s*c-r*a,this.y=r*o-n*c,this.z=n*a-s*o,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return El.copy(this).projectOnVector(e),this.sub(El)}reflect(e){return this.sub(El.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(Xe(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},El=new L,eh=new Gt,Ge=class i{constructor(e,t,n,s,r,o,a,c,l){i.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,c,l)}set(e,t,n,s,r,o,a,c,l){let u=this.elements;return u[0]=e,u[1]=s,u[2]=a,u[3]=t,u[4]=r,u[5]=c,u[6]=n,u[7]=o,u[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],u=n[4],h=n[7],d=n[2],p=n[5],g=n[8],x=s[0],m=s[3],f=s[6],T=s[1],b=s[4],M=s[7],A=s[2],E=s[5],C=s[8];return r[0]=o*x+a*T+c*A,r[3]=o*m+a*b+c*E,r[6]=o*f+a*M+c*C,r[1]=l*x+u*T+h*A,r[4]=l*m+u*b+h*E,r[7]=l*f+u*M+h*C,r[2]=d*x+p*T+g*A,r[5]=d*m+p*b+g*E,r[8]=d*f+p*M+g*C,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8];return t*o*u-t*a*l-n*r*u+n*a*c+s*r*l-s*o*c}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8],h=u*o-a*l,d=a*c-u*r,p=l*r-o*c,g=t*h+n*d+s*p;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);let x=1/g;return e[0]=h*x,e[1]=(s*l-u*n)*x,e[2]=(a*n-s*o)*x,e[3]=d*x,e[4]=(u*t-s*c)*x,e[5]=(s*r-a*t)*x,e[6]=p*x,e[7]=(n*c-l*t)*x,e[8]=(o*t-n*r)*x,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){let c=Math.cos(r),l=Math.sin(r);return this.set(n*c,n*l,-n*(c*o+l*a)+o+e,-s*l,s*c,-s*(-l*o+c*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Al.makeScale(e,t)),this}rotate(e){return this.premultiply(Al.makeRotation(-e)),this}translate(e,t){return this.premultiply(Al.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Al=new Ge;function Rc(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function gs(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function Ed(){let i=gs("canvas");return i.style.display="block",i}var th={};function _s(i){i in th||(th[i]=!0,console.warn(i))}function Ad(i,e,t){return new Promise(function(n,s){function r(){switch(i.clientWaitSync(e,i.SYNC_FLUSH_COMMANDS_BIT,0)){case i.WAIT_FAILED:s();break;case i.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}var nh=new Ge().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),ih=new Ge().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function xm(){let i={enabled:!0,workingColorSpace:Lt,spaces:{},convert:function(s,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===at&&(s.r=Wn(s.r),s.g=Wn(s.g),s.b=Wn(s.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(s.applyMatrix3(this.spaces[r].toXYZ),s.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===at&&(s.r=fs(s.r),s.g=fs(s.g),s.b=fs(s.b))),s},workingToColorSpace:function(s,r){return this.convert(s,this.workingColorSpace,r)},colorSpaceToWorking:function(s,r){return this.convert(s,r,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Jn?sr:this.spaces[s].transfer},getToneMappingMode:function(s){return this.spaces[s].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(s,r=this.workingColorSpace){return s.fromArray(this.spaces[r].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,r,o){return s.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(s,r){return _s("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),i.workingToColorSpace(s,r)},toWorkingColorSpace:function(s,r){return _s("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),i.colorSpaceToWorking(s,r)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return i.define({[Lt]:{primaries:e,whitePoint:n,transfer:sr,toXYZ:nh,fromXYZ:ih,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:bt},outputColorSpaceConfig:{drawingBufferColorSpace:bt}},[bt]:{primaries:e,whitePoint:n,transfer:at,toXYZ:nh,fromXYZ:ih,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:bt}}}),i}var Ke=xm();function Wn(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function fs(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}var ji,No=class{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{ji===void 0&&(ji=gs("canvas")),ji.width=e.width,ji.height=e.height;let s=ji.getContext("2d");e instanceof ImageData?s.putImageData(e,0,0):s.drawImage(e,0,0,e.width,e.height),n=ji}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){let t=gs("canvas");t.width=e.width,t.height=e.height;let n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);let s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=Wn(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){let t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Wn(t[n]/255)*255):t[n]=Wn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}},ym=0,xs=class{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:ym++}),this.uuid=_n(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):t instanceof VideoFrame?e.set(t.displayHeight,t.displayWidth,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(wl(s[o].image)):r.push(wl(s[o]))}else r=wl(s);n.url=r}return t||(e.images[this.uuid]=n),n}};function wl(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?No.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}var vm=0,Rl=new L,Tt=class i extends wn{constructor(e=i.DEFAULT_IMAGE,t=i.DEFAULT_MAPPING,n=En,s=En,r=Vt,o=Sn,a=tn,c=Mn,l=i.DEFAULT_ANISOTROPY,u=Jn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:vm++}),this.uuid=_n(),this.name="",this.source=new xs(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new we(0,0),this.repeat=new we(1,1),this.center=new we(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ge,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(Rl).x}get height(){return this.source.getSize(Rl).y}get depth(){return this.source.getSize(Rl).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Texture.setValues(): property '${t}' does not exist.`);continue}s&&n&&s.isVector2&&n.isVector2||s&&n&&s.isVector3&&n.isVector3||s&&n&&s.isMatrix3&&n.isMatrix3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==gc)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case oi:e.x=e.x-Math.floor(e.x);break;case En:e.x=e.x<0?0:1;break;case ps:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case oi:e.y=e.y-Math.floor(e.y);break;case En:e.y=e.y<0?0:1;break;case ps:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Tt.DEFAULT_IMAGE=null;Tt.DEFAULT_MAPPING=gc;Tt.DEFAULT_ANISOTROPY=1;var Je=class i{constructor(e=0,t=0,n=0,s=1){i.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r,c=e.elements,l=c[0],u=c[4],h=c[8],d=c[1],p=c[5],g=c[9],x=c[2],m=c[6],f=c[10];if(Math.abs(u-d)<.01&&Math.abs(h-x)<.01&&Math.abs(g-m)<.01){if(Math.abs(u+d)<.1&&Math.abs(h+x)<.1&&Math.abs(g+m)<.1&&Math.abs(l+p+f-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;let b=(l+1)/2,M=(p+1)/2,A=(f+1)/2,E=(u+d)/4,C=(h+x)/4,D=(g+m)/4;return b>M&&b>A?b<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(b),s=E/n,r=C/n):M>A?M<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(M),n=E/s,r=D/s):A<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(A),n=C/r,s=D/r),this.set(n,s,r,t),this}let T=Math.sqrt((m-g)*(m-g)+(h-x)*(h-x)+(d-u)*(d-u));return Math.abs(T)<.001&&(T=1),this.x=(m-g)/T,this.y=(h-x)/T,this.z=(d-u)/T,this.w=Math.acos((l+p+f-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Xe(this.x,e.x,t.x),this.y=Xe(this.y,e.y,t.y),this.z=Xe(this.z,e.z,t.z),this.w=Xe(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Xe(this.x,e,t),this.y=Xe(this.y,e,t),this.z=Xe(this.z,e,t),this.w=Xe(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(Xe(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Oo=class extends wn{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Vt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new Je(0,0,e,t),this.scissorTest=!1,this.viewport=new Je(0,0,e,t);let s={width:e,height:t,depth:n.depth},r=new Tt(s);this.textures=[];let o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(e={}){let t={minFilter:Vt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let s=0,r=this.textures.length;s<r;s++)this.textures[s].image.width=e,this.textures[s].image.height=t,this.textures[s].image.depth=n,this.textures[s].isArrayTexture=this.textures[s].image.depth>1;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let s=Object.assign({},e.textures[t].image);this.textures[t].source=new xs(s)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}},Rn=class extends Oo{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},or=class extends Tt{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Pt,this.minFilter=Pt,this.wrapR=En,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}};var Uo=class extends Tt{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Pt,this.minFilter=Pt,this.wrapR=En,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}};var Wt=class{constructor(e=new L(1/0,1/0,1/0),t=new L(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(dn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(dn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=dn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,dn):dn.fromBufferAttribute(r,o),dn.applyMatrix4(e.matrixWorld),this.expandByPoint(dn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),to.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),to.copy(n.boundingBox)),to.applyMatrix4(e.matrixWorld),this.union(to)}let s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,dn),dn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Xs),no.subVectors(this.max,Xs),Ki.subVectors(e.a,Xs),Zi.subVectors(e.b,Xs),Ji.subVectors(e.c,Xs),Qn.subVectors(Zi,Ki),ei.subVectors(Ji,Zi),gi.subVectors(Ki,Ji);let t=[0,-Qn.z,Qn.y,0,-ei.z,ei.y,0,-gi.z,gi.y,Qn.z,0,-Qn.x,ei.z,0,-ei.x,gi.z,0,-gi.x,-Qn.y,Qn.x,0,-ei.y,ei.x,0,-gi.y,gi.x,0];return!Cl(t,Ki,Zi,Ji,no)||(t=[1,0,0,0,1,0,0,0,1],!Cl(t,Ki,Zi,Ji,no))?!1:(io.crossVectors(Qn,ei),t=[io.x,io.y,io.z],Cl(t,Ki,Zi,Ji,no))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,dn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(dn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Fn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Fn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Fn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Fn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Fn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Fn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Fn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Fn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Fn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Fn=[new L,new L,new L,new L,new L,new L,new L,new L],dn=new L,to=new Wt,Ki=new L,Zi=new L,Ji=new L,Qn=new L,ei=new L,gi=new L,Xs=new L,no=new L,io=new L,_i=new L;function Cl(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){_i.fromArray(i,r);let a=s.x*Math.abs(_i.x)+s.y*Math.abs(_i.y)+s.z*Math.abs(_i.z),c=e.dot(_i),l=t.dot(_i),u=n.dot(_i);if(Math.max(-Math.max(c,l,u),Math.min(c,l,u))>a)return!1}return!0}var Sm=new Wt,Ys=new L,Il=new L,Ot=class{constructor(e=new L,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t!==void 0?n.copy(t):Sm.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ys.subVectors(e,this.center);let t=Ys.lengthSq();if(t>this.radius*this.radius){let n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Ys,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Il.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ys.copy(e.center).add(Il)),this.expandByPoint(Ys.copy(e.center).sub(Il))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},Bn=new L,Pl=new L,so=new L,ti=new L,Ll=new L,ro=new L,Dl=new L,Xn=class{constructor(e=new L,t=new L(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Bn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Bn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Bn.copy(this.origin).addScaledVector(this.direction,t),Bn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){Pl.copy(e).add(t).multiplyScalar(.5),so.copy(t).sub(e).normalize(),ti.copy(this.origin).sub(Pl);let r=e.distanceTo(t)*.5,o=-this.direction.dot(so),a=ti.dot(this.direction),c=-ti.dot(so),l=ti.lengthSq(),u=Math.abs(1-o*o),h,d,p,g;if(u>0)if(h=o*c-a,d=o*a-c,g=r*u,h>=0)if(d>=-g)if(d<=g){let x=1/u;h*=x,d*=x,p=h*(h+o*d+2*a)+d*(o*h+d+2*c)+l}else d=r,h=Math.max(0,-(o*d+a)),p=-h*h+d*(d+2*c)+l;else d=-r,h=Math.max(0,-(o*d+a)),p=-h*h+d*(d+2*c)+l;else d<=-g?(h=Math.max(0,-(-o*r+a)),d=h>0?-r:Math.min(Math.max(-r,-c),r),p=-h*h+d*(d+2*c)+l):d<=g?(h=0,d=Math.min(Math.max(-r,-c),r),p=d*(d+2*c)+l):(h=Math.max(0,-(o*r+a)),d=h>0?r:Math.min(Math.max(-r,-c),r),p=-h*h+d*(d+2*c)+l);else d=o>0?-r:r,h=Math.max(0,-(o*d+a)),p=-h*h+d*(d+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,h),s&&s.copy(Pl).addScaledVector(so,d),p}intersectSphere(e,t){Bn.subVectors(e.center,this.origin);let n=Bn.dot(this.direction),s=Bn.dot(Bn)-n*n,r=e.radius*e.radius;if(s>r)return null;let o=Math.sqrt(r-s),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,t):this.at(a,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,c,l=1/this.direction.x,u=1/this.direction.y,h=1/this.direction.z,d=this.origin;return l>=0?(n=(e.min.x-d.x)*l,s=(e.max.x-d.x)*l):(n=(e.max.x-d.x)*l,s=(e.min.x-d.x)*l),u>=0?(r=(e.min.y-d.y)*u,o=(e.max.y-d.y)*u):(r=(e.max.y-d.y)*u,o=(e.min.y-d.y)*u),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),h>=0?(a=(e.min.z-d.z)*h,c=(e.max.z-d.z)*h):(a=(e.max.z-d.z)*h,c=(e.min.z-d.z)*h),n>c||a>s)||((a>n||n!==n)&&(n=a),(c<s||s!==s)&&(s=c),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,Bn)!==null}intersectTriangle(e,t,n,s,r){Ll.subVectors(t,e),ro.subVectors(n,e),Dl.crossVectors(Ll,ro);let o=this.direction.dot(Dl),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;ti.subVectors(this.origin,e);let c=a*this.direction.dot(ro.crossVectors(ti,ro));if(c<0)return null;let l=a*this.direction.dot(Ll.cross(ti));if(l<0||c+l>o)return null;let u=-a*ti.dot(Dl);return u<0?null:this.at(u/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Ve=class i{constructor(e,t,n,s,r,o,a,c,l,u,h,d,p,g,x,m){i.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,c,l,u,h,d,p,g,x,m)}set(e,t,n,s,r,o,a,c,l,u,h,d,p,g,x,m){let f=this.elements;return f[0]=e,f[4]=t,f[8]=n,f[12]=s,f[1]=r,f[5]=o,f[9]=a,f[13]=c,f[2]=l,f[6]=u,f[10]=h,f[14]=d,f[3]=p,f[7]=g,f[11]=x,f[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new i().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){let t=this.elements,n=e.elements,s=1/Qi.setFromMatrixColumn(e,0).length(),r=1/Qi.setFromMatrixColumn(e,1).length(),o=1/Qi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(s),l=Math.sin(s),u=Math.cos(r),h=Math.sin(r);if(e.order==="XYZ"){let d=o*u,p=o*h,g=a*u,x=a*h;t[0]=c*u,t[4]=-c*h,t[8]=l,t[1]=p+g*l,t[5]=d-x*l,t[9]=-a*c,t[2]=x-d*l,t[6]=g+p*l,t[10]=o*c}else if(e.order==="YXZ"){let d=c*u,p=c*h,g=l*u,x=l*h;t[0]=d+x*a,t[4]=g*a-p,t[8]=o*l,t[1]=o*h,t[5]=o*u,t[9]=-a,t[2]=p*a-g,t[6]=x+d*a,t[10]=o*c}else if(e.order==="ZXY"){let d=c*u,p=c*h,g=l*u,x=l*h;t[0]=d-x*a,t[4]=-o*h,t[8]=g+p*a,t[1]=p+g*a,t[5]=o*u,t[9]=x-d*a,t[2]=-o*l,t[6]=a,t[10]=o*c}else if(e.order==="ZYX"){let d=o*u,p=o*h,g=a*u,x=a*h;t[0]=c*u,t[4]=g*l-p,t[8]=d*l+x,t[1]=c*h,t[5]=x*l+d,t[9]=p*l-g,t[2]=-l,t[6]=a*c,t[10]=o*c}else if(e.order==="YZX"){let d=o*c,p=o*l,g=a*c,x=a*l;t[0]=c*u,t[4]=x-d*h,t[8]=g*h+p,t[1]=h,t[5]=o*u,t[9]=-a*u,t[2]=-l*u,t[6]=p*h+g,t[10]=d-x*h}else if(e.order==="XZY"){let d=o*c,p=o*l,g=a*c,x=a*l;t[0]=c*u,t[4]=-h,t[8]=l*u,t[1]=d*h+x,t[5]=o*u,t[9]=p*h-g,t[2]=g*h-p,t[6]=a*u,t[10]=x*h+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Mm,e,bm)}lookAt(e,t,n){let s=this.elements;return Qt.subVectors(e,t),Qt.lengthSq()===0&&(Qt.z=1),Qt.normalize(),ni.crossVectors(n,Qt),ni.lengthSq()===0&&(Math.abs(n.z)===1?Qt.x+=1e-4:Qt.z+=1e-4,Qt.normalize(),ni.crossVectors(n,Qt)),ni.normalize(),oo.crossVectors(Qt,ni),s[0]=ni.x,s[4]=oo.x,s[8]=Qt.x,s[1]=ni.y,s[5]=oo.y,s[9]=Qt.y,s[2]=ni.z,s[6]=oo.z,s[10]=Qt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],u=n[1],h=n[5],d=n[9],p=n[13],g=n[2],x=n[6],m=n[10],f=n[14],T=n[3],b=n[7],M=n[11],A=n[15],E=s[0],C=s[4],D=s[8],S=s[12],y=s[1],P=s[5],F=s[9],k=s[13],H=s[2],q=s[6],W=s[10],te=s[14],V=s[3],oe=s[7],ce=s[11],Te=s[15];return r[0]=o*E+a*y+c*H+l*V,r[4]=o*C+a*P+c*q+l*oe,r[8]=o*D+a*F+c*W+l*ce,r[12]=o*S+a*k+c*te+l*Te,r[1]=u*E+h*y+d*H+p*V,r[5]=u*C+h*P+d*q+p*oe,r[9]=u*D+h*F+d*W+p*ce,r[13]=u*S+h*k+d*te+p*Te,r[2]=g*E+x*y+m*H+f*V,r[6]=g*C+x*P+m*q+f*oe,r[10]=g*D+x*F+m*W+f*ce,r[14]=g*S+x*k+m*te+f*Te,r[3]=T*E+b*y+M*H+A*V,r[7]=T*C+b*P+M*q+A*oe,r[11]=T*D+b*F+M*W+A*ce,r[15]=T*S+b*k+M*te+A*Te,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],c=e[9],l=e[13],u=e[2],h=e[6],d=e[10],p=e[14],g=e[3],x=e[7],m=e[11],f=e[15];return g*(+r*c*h-s*l*h-r*a*d+n*l*d+s*a*p-n*c*p)+x*(+t*c*p-t*l*d+r*o*d-s*o*p+s*l*u-r*c*u)+m*(+t*l*h-t*a*p-r*o*h+n*o*p+r*a*u-n*l*u)+f*(-s*a*u-t*c*h+t*a*d+s*o*h-n*o*d+n*c*u)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8],h=e[9],d=e[10],p=e[11],g=e[12],x=e[13],m=e[14],f=e[15],T=h*m*l-x*d*l+x*c*p-a*m*p-h*c*f+a*d*f,b=g*d*l-u*m*l-g*c*p+o*m*p+u*c*f-o*d*f,M=u*x*l-g*h*l+g*a*p-o*x*p-u*a*f+o*h*f,A=g*h*c-u*x*c-g*a*d+o*x*d+u*a*m-o*h*m,E=t*T+n*b+s*M+r*A;if(E===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let C=1/E;return e[0]=T*C,e[1]=(x*d*r-h*m*r-x*s*p+n*m*p+h*s*f-n*d*f)*C,e[2]=(a*m*r-x*c*r+x*s*l-n*m*l-a*s*f+n*c*f)*C,e[3]=(h*c*r-a*d*r-h*s*l+n*d*l+a*s*p-n*c*p)*C,e[4]=b*C,e[5]=(u*m*r-g*d*r+g*s*p-t*m*p-u*s*f+t*d*f)*C,e[6]=(g*c*r-o*m*r-g*s*l+t*m*l+o*s*f-t*c*f)*C,e[7]=(o*d*r-u*c*r+u*s*l-t*d*l-o*s*p+t*c*p)*C,e[8]=M*C,e[9]=(g*h*r-u*x*r-g*n*p+t*x*p+u*n*f-t*h*f)*C,e[10]=(o*x*r-g*a*r+g*n*l-t*x*l-o*n*f+t*a*f)*C,e[11]=(u*a*r-o*h*r-u*n*l+t*h*l+o*n*p-t*a*p)*C,e[12]=A*C,e[13]=(u*x*s-g*h*s+g*n*d-t*x*d-u*n*m+t*h*m)*C,e[14]=(g*a*s-o*x*s-g*n*c+t*x*c+o*n*m-t*a*m)*C,e[15]=(o*h*s-u*a*s+u*n*c-t*h*c-o*n*d+t*a*d)*C,this}scale(e){let t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,c=e.z,l=r*o,u=r*a;return this.set(l*o+n,l*a-s*c,l*c+s*a,0,l*a+s*c,u*a+n,u*c-s*o,0,l*c-s*a,u*c+s*o,r*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){let s=this.elements,r=t._x,o=t._y,a=t._z,c=t._w,l=r+r,u=o+o,h=a+a,d=r*l,p=r*u,g=r*h,x=o*u,m=o*h,f=a*h,T=c*l,b=c*u,M=c*h,A=n.x,E=n.y,C=n.z;return s[0]=(1-(x+f))*A,s[1]=(p+M)*A,s[2]=(g-b)*A,s[3]=0,s[4]=(p-M)*E,s[5]=(1-(d+f))*E,s[6]=(m+T)*E,s[7]=0,s[8]=(g+b)*C,s[9]=(m-T)*C,s[10]=(1-(d+x))*C,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){let s=this.elements,r=Qi.set(s[0],s[1],s[2]).length(),o=Qi.set(s[4],s[5],s[6]).length(),a=Qi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],fn.copy(this);let l=1/r,u=1/o,h=1/a;return fn.elements[0]*=l,fn.elements[1]*=l,fn.elements[2]*=l,fn.elements[4]*=u,fn.elements[5]*=u,fn.elements[6]*=u,fn.elements[8]*=h,fn.elements[9]*=h,fn.elements[10]*=h,t.setFromRotationMatrix(fn),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=gn,c=!1){let l=this.elements,u=2*r/(t-e),h=2*r/(n-s),d=(t+e)/(t-e),p=(n+s)/(n-s),g,x;if(c)g=r/(o-r),x=o*r/(o-r);else if(a===gn)g=-(o+r)/(o-r),x=-2*o*r/(o-r);else if(a===rr)g=-o/(o-r),x=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=u,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=h,l[9]=p,l[13]=0,l[2]=0,l[6]=0,l[10]=g,l[14]=x,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=gn,c=!1){let l=this.elements,u=2/(t-e),h=2/(n-s),d=-(t+e)/(t-e),p=-(n+s)/(n-s),g,x;if(c)g=1/(o-r),x=o/(o-r);else if(a===gn)g=-2/(o-r),x=-(o+r)/(o-r);else if(a===rr)g=-1/(o-r),x=-r/(o-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=u,l[4]=0,l[8]=0,l[12]=d,l[1]=0,l[5]=h,l[9]=0,l[13]=p,l[2]=0,l[6]=0,l[10]=g,l[14]=x,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},Qi=new L,fn=new Ve,Mm=new L(0,0,0),bm=new L(1,1,1),ni=new L,oo=new L,Qt=new L,sh=new Ve,rh=new Gt,cn=class i{constructor(e=0,t=0,n=0,s=i.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let s=e.elements,r=s[0],o=s[4],a=s[8],c=s[1],l=s[5],u=s[9],h=s[2],d=s[6],p=s[10];switch(t){case"XYZ":this._y=Math.asin(Xe(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,p),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(d,l),this._z=0);break;case"YXZ":this._x=Math.asin(-Xe(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,p),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-h,r),this._z=0);break;case"ZXY":this._x=Math.asin(Xe(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-h,p),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,r));break;case"ZYX":this._y=Math.asin(-Xe(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(d,p),this._z=Math.atan2(c,r)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin(Xe(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-u,l),this._y=Math.atan2(-h,r)):(this._x=0,this._y=Math.atan2(a,p));break;case"XZY":this._z=Math.asin(-Xe(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(d,l),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-u,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return sh.makeRotationFromQuaternion(e),this.setFromRotationMatrix(sh,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return rh.setFromEuler(this),this.setFromQuaternion(rh,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};cn.DEFAULT_ORDER="XYZ";var ar=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}},Tm=0,oh=new L,es=new Gt,zn=new Ve,ao=new L,qs=new L,Em=new L,Am=new Gt,ah=new L(1,0,0),lh=new L(0,1,0),ch=new L(0,0,1),uh={type:"added"},wm={type:"removed"},ts={type:"childadded",child:null},Nl={type:"childremoved",child:null},ht=class i extends wn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Tm++}),this.uuid=_n(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=i.DEFAULT_UP.clone();let e=new L,t=new cn,n=new Gt,s=new L(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new Ve},normalMatrix:{value:new Ge}}),this.matrix=new Ve,this.matrixWorld=new Ve,this.matrixAutoUpdate=i.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=i.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ar,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return es.setFromAxisAngle(e,t),this.quaternion.multiply(es),this}rotateOnWorldAxis(e,t){return es.setFromAxisAngle(e,t),this.quaternion.premultiply(es),this}rotateX(e){return this.rotateOnAxis(ah,e)}rotateY(e){return this.rotateOnAxis(lh,e)}rotateZ(e){return this.rotateOnAxis(ch,e)}translateOnAxis(e,t){return oh.copy(e).applyQuaternion(this.quaternion),this.position.add(oh.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ah,e)}translateY(e){return this.translateOnAxis(lh,e)}translateZ(e){return this.translateOnAxis(ch,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(zn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ao.copy(e):ao.set(e,t,n);let s=this.parent;this.updateWorldMatrix(!0,!1),qs.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?zn.lookAt(qs,ao,this.up):zn.lookAt(ao,qs,this.up),this.quaternion.setFromRotationMatrix(zn),s&&(zn.extractRotation(s.matrixWorld),es.setFromRotationMatrix(zn),this.quaternion.premultiply(es.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(uh),ts.child=e,this.dispatchEvent(ts),ts.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(wm),Nl.child=e,this.dispatchEvent(Nl),Nl.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),zn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),zn.multiply(e.parent.matrixWorld)),e.applyMatrix4(zn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(uh),ts.child=e,this.dispatchEvent(ts),ts.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){let o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(qs,e,Em),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(qs,Am,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){let n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){let s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].updateWorldMatrix(!1,!0)}}toJSON(e){let t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),s.instanceInfo=this._instanceInfo.map(a=>({...a})),s.availableInstanceIds=this._availableInstanceIds.slice(),s.availableGeometryIds=this._availableGeometryIds.slice(),s.nextIndexStart=this._nextIndexStart,s.nextVertexStart=this._nextVertexStart,s.geometryCount=this._geometryCount,s.maxInstanceCount=this._maxInstanceCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.matricesTexture=this._matricesTexture.toJSON(e),s.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(s.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(s.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(s.boundingBox=this.boundingBox.toJSON()));function r(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let c=a.shapes;if(Array.isArray(c))for(let l=0,u=c.length;l<u;l++){let h=c[l];r(e.shapes,h)}else r(e.shapes,c)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(r(e.materials,this.material[c]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){let c=this.animations[a];s.animations.push(r(e.animations,c))}}if(t){let a=o(e.geometries),c=o(e.materials),l=o(e.textures),u=o(e.images),h=o(e.shapes),d=o(e.skeletons),p=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),u.length>0&&(n.images=u),h.length>0&&(n.shapes=h),d.length>0&&(n.skeletons=d),p.length>0&&(n.animations=p),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){let c=[];for(let l in a){let u=a[l];delete u.metadata,c.push(u)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){let s=e.children[n];this.add(s.clone())}return this}};ht.DEFAULT_UP=new L(0,1,0);ht.DEFAULT_MATRIX_AUTO_UPDATE=!0;ht.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var pn=new L,kn=new L,Ol=new L,Hn=new L,ns=new L,is=new L,hh=new L,Ul=new L,Fl=new L,Bl=new L,zl=new Je,kl=new Je,Hl=new Je,Gn=class i{constructor(e=new L,t=new L,n=new L){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),pn.subVectors(e,t),s.cross(pn);let r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){pn.subVectors(s,t),kn.subVectors(n,t),Ol.subVectors(e,t);let o=pn.dot(pn),a=pn.dot(kn),c=pn.dot(Ol),l=kn.dot(kn),u=kn.dot(Ol),h=o*l-a*a;if(h===0)return r.set(0,0,0),null;let d=1/h,p=(l*c-a*u)*d,g=(o*u-a*c)*d;return r.set(1-p-g,g,p)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,Hn)===null?!1:Hn.x>=0&&Hn.y>=0&&Hn.x+Hn.y<=1}static getInterpolation(e,t,n,s,r,o,a,c){return this.getBarycoord(e,t,n,s,Hn)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(r,Hn.x),c.addScaledVector(o,Hn.y),c.addScaledVector(a,Hn.z),c)}static getInterpolatedAttribute(e,t,n,s,r,o){return zl.setScalar(0),kl.setScalar(0),Hl.setScalar(0),zl.fromBufferAttribute(e,t),kl.fromBufferAttribute(e,n),Hl.fromBufferAttribute(e,s),o.setScalar(0),o.addScaledVector(zl,r.x),o.addScaledVector(kl,r.y),o.addScaledVector(Hl,r.z),o}static isFrontFacing(e,t,n,s){return pn.subVectors(n,t),kn.subVectors(e,t),pn.cross(kn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return pn.subVectors(this.c,this.b),kn.subVectors(this.a,this.b),pn.cross(kn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return i.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return i.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,s,r){return i.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return i.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return i.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,s=this.b,r=this.c,o,a;ns.subVectors(s,n),is.subVectors(r,n),Ul.subVectors(e,n);let c=ns.dot(Ul),l=is.dot(Ul);if(c<=0&&l<=0)return t.copy(n);Fl.subVectors(e,s);let u=ns.dot(Fl),h=is.dot(Fl);if(u>=0&&h<=u)return t.copy(s);let d=c*h-u*l;if(d<=0&&c>=0&&u<=0)return o=c/(c-u),t.copy(n).addScaledVector(ns,o);Bl.subVectors(e,r);let p=ns.dot(Bl),g=is.dot(Bl);if(g>=0&&p<=g)return t.copy(r);let x=p*l-c*g;if(x<=0&&l>=0&&g<=0)return a=l/(l-g),t.copy(n).addScaledVector(is,a);let m=u*g-p*h;if(m<=0&&h-u>=0&&p-g>=0)return hh.subVectors(r,s),a=(h-u)/(h-u+(p-g)),t.copy(s).addScaledVector(hh,a);let f=1/(m+x+d);return o=x*f,a=d*f,t.copy(n).addScaledVector(ns,o).addScaledVector(is,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},wd={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},ii={h:0,s:0,l:0},lo={h:0,s:0,l:0};function Vl(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}var Pe=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=bt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Ke.colorSpaceToWorking(this,t),this}setRGB(e,t,n,s=Ke.workingColorSpace){return this.r=e,this.g=t,this.b=n,Ke.colorSpaceToWorking(this,s),this}setHSL(e,t,n,s=Ke.workingColorSpace){if(e=wc(e,1),t=Xe(t,0,1),n=Xe(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=Vl(o,r,e+1/3),this.g=Vl(o,r,e),this.b=Vl(o,r,e-1/3)}return Ke.colorSpaceToWorking(this,s),this}setStyle(e,t=bt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r,o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){let r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=bt){let n=wd[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Wn(e.r),this.g=Wn(e.g),this.b=Wn(e.b),this}copyLinearToSRGB(e){return this.r=fs(e.r),this.g=fs(e.g),this.b=fs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=bt){return Ke.workingToColorSpace(Nt.copy(this),e),Math.round(Xe(Nt.r*255,0,255))*65536+Math.round(Xe(Nt.g*255,0,255))*256+Math.round(Xe(Nt.b*255,0,255))}getHexString(e=bt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Ke.workingColorSpace){Ke.workingToColorSpace(Nt.copy(this),t);let n=Nt.r,s=Nt.g,r=Nt.b,o=Math.max(n,s,r),a=Math.min(n,s,r),c,l,u=(a+o)/2;if(a===o)c=0,l=0;else{let h=o-a;switch(l=u<=.5?h/(o+a):h/(2-o-a),o){case n:c=(s-r)/h+(s<r?6:0);break;case s:c=(r-n)/h+2;break;case r:c=(n-s)/h+4;break}c/=6}return e.h=c,e.s=l,e.l=u,e}getRGB(e,t=Ke.workingColorSpace){return Ke.workingToColorSpace(Nt.copy(this),t),e.r=Nt.r,e.g=Nt.g,e.b=Nt.b,e}getStyle(e=bt){Ke.workingToColorSpace(Nt.copy(this),e);let t=Nt.r,n=Nt.g,s=Nt.b;return e!==bt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(ii),this.setHSL(ii.h+e,ii.s+t,ii.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(ii),e.getHSL(lo);let n=ir(ii.h,lo.h,t),s=ir(ii.s,lo.s,t),r=ir(ii.l,lo.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Nt=new Pe;Pe.NAMES=wd;var Rm=0,Ut=class extends wn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Rm++}),this.uuid=_n(),this.name="",this.type="Material",this.blending=Si,this.side=xn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Po,this.blendDst=Lo,this.blendEquation=ri,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Pe(0,0,0),this.blendAlpha=0,this.depthFunc=Mi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=sc,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=vi,this.stencilZFail=vi,this.stencilZPass=vi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}let s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Si&&(n.blending=this.blending),this.side!==xn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Po&&(n.blendSrc=this.blendSrc),this.blendDst!==Lo&&(n.blendDst=this.blendDst),this.blendEquation!==ri&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Mi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==sc&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==vi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==vi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==vi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){let o=[];for(let a in r){let c=r[a];delete c.metadata,o.push(c)}return o}if(t){let r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}},Ft=class extends Ut{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Pe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.combine=ra,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}};var yt=new L,co=new we,Cm=0,Mt=class{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Cm++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Do,this.updateRanges=[],this.gpuType=un,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)co.fromBufferAttribute(this,t),co.applyMatrix3(e),this.setXY(t,co.x,co.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyMatrix3(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyMatrix4(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyNormalMatrix(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.transformDirection(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=mn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ot(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=mn(t,this.array)),t}setX(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=mn(t,this.array)),t}setY(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=mn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=mn(t,this.array)),t}setW(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),s=ot(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),s=ot(s,this.array),r=ot(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Do&&(e.usage=this.usage),e}};var lr=class extends Mt{constructor(e,t,n){super(new Uint16Array(e),t,n)}};var cr=class extends Mt{constructor(e,t,n){super(new Uint32Array(e),t,n)}};var it=class extends Mt{constructor(e,t,n){super(new Float32Array(e),t,n)}},Im=0,an=new Ve,Gl=new ht,ss=new L,en=new Wt,$s=new Wt,Ct=new L,_t=class i extends wn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Im++}),this.uuid=_n(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Rc(e)?cr:lr)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new Ge().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}let s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return an.makeRotationFromQuaternion(e),this.applyMatrix4(an),this}rotateX(e){return an.makeRotationX(e),this.applyMatrix4(an),this}rotateY(e){return an.makeRotationY(e),this.applyMatrix4(an),this}rotateZ(e){return an.makeRotationZ(e),this.applyMatrix4(an),this}translate(e,t,n){return an.makeTranslation(e,t,n),this.applyMatrix4(an),this}scale(e,t,n){return an.makeScale(e,t,n),this.applyMatrix4(an),this}lookAt(e){return Gl.lookAt(e),Gl.updateMatrix(),this.applyMatrix4(Gl.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ss).negate(),this.translate(ss.x,ss.y,ss.z),this}setFromPoints(e){let t=this.getAttribute("position");if(t===void 0){let n=[];for(let s=0,r=e.length;s<r;s++){let o=e[s];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new it(n,3))}else{let n=Math.min(e.length,t.count);for(let s=0;s<n;s++){let r=e[s];t.setXYZ(s,r.x,r.y,r.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Wt);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new L(-1/0,-1/0,-1/0),new L(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){let r=t[n];en.setFromBufferAttribute(r),this.morphTargetsRelative?(Ct.addVectors(this.boundingBox.min,en.min),this.boundingBox.expandByPoint(Ct),Ct.addVectors(this.boundingBox.max,en.max),this.boundingBox.expandByPoint(Ct)):(this.boundingBox.expandByPoint(en.min),this.boundingBox.expandByPoint(en.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Ot);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new L,1/0);return}if(e){let n=this.boundingSphere.center;if(en.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){let a=t[r];$s.setFromBufferAttribute(a),this.morphTargetsRelative?(Ct.addVectors(en.min,$s.min),en.expandByPoint(Ct),Ct.addVectors(en.max,$s.max),en.expandByPoint(Ct)):(en.expandByPoint($s.min),en.expandByPoint($s.max))}en.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)Ct.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(Ct));if(t)for(let r=0,o=t.length;r<o;r++){let a=t[r],c=this.morphTargetsRelative;for(let l=0,u=a.count;l<u;l++)Ct.fromBufferAttribute(a,l),c&&(ss.fromBufferAttribute(e,l),Ct.add(ss)),s=Math.max(s,n.distanceToSquared(Ct))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=t.position,s=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Mt(new Float32Array(4*n.count),4));let o=this.getAttribute("tangent"),a=[],c=[];for(let D=0;D<n.count;D++)a[D]=new L,c[D]=new L;let l=new L,u=new L,h=new L,d=new we,p=new we,g=new we,x=new L,m=new L;function f(D,S,y){l.fromBufferAttribute(n,D),u.fromBufferAttribute(n,S),h.fromBufferAttribute(n,y),d.fromBufferAttribute(r,D),p.fromBufferAttribute(r,S),g.fromBufferAttribute(r,y),u.sub(l),h.sub(l),p.sub(d),g.sub(d);let P=1/(p.x*g.y-g.x*p.y);isFinite(P)&&(x.copy(u).multiplyScalar(g.y).addScaledVector(h,-p.y).multiplyScalar(P),m.copy(h).multiplyScalar(p.x).addScaledVector(u,-g.x).multiplyScalar(P),a[D].add(x),a[S].add(x),a[y].add(x),c[D].add(m),c[S].add(m),c[y].add(m))}let T=this.groups;T.length===0&&(T=[{start:0,count:e.count}]);for(let D=0,S=T.length;D<S;++D){let y=T[D],P=y.start,F=y.count;for(let k=P,H=P+F;k<H;k+=3)f(e.getX(k+0),e.getX(k+1),e.getX(k+2))}let b=new L,M=new L,A=new L,E=new L;function C(D){A.fromBufferAttribute(s,D),E.copy(A);let S=a[D];b.copy(S),b.sub(A.multiplyScalar(A.dot(S))).normalize(),M.crossVectors(E,S);let P=M.dot(c[D])<0?-1:1;o.setXYZW(D,b.x,b.y,b.z,P)}for(let D=0,S=T.length;D<S;++D){let y=T[D],P=y.start,F=y.count;for(let k=P,H=P+F;k<H;k+=3)C(e.getX(k+0)),C(e.getX(k+1)),C(e.getX(k+2))}}computeVertexNormals(){let e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Mt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,p=n.count;d<p;d++)n.setXYZ(d,0,0,0);let s=new L,r=new L,o=new L,a=new L,c=new L,l=new L,u=new L,h=new L;if(e)for(let d=0,p=e.count;d<p;d+=3){let g=e.getX(d+0),x=e.getX(d+1),m=e.getX(d+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,x),o.fromBufferAttribute(t,m),u.subVectors(o,r),h.subVectors(s,r),u.cross(h),a.fromBufferAttribute(n,g),c.fromBufferAttribute(n,x),l.fromBufferAttribute(n,m),a.add(u),c.add(u),l.add(u),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(x,c.x,c.y,c.z),n.setXYZ(m,l.x,l.y,l.z)}else for(let d=0,p=t.count;d<p;d+=3)s.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),o.fromBufferAttribute(t,d+2),u.subVectors(o,r),h.subVectors(s,r),u.cross(h),n.setXYZ(d+0,u.x,u.y,u.z),n.setXYZ(d+1,u.x,u.y,u.z),n.setXYZ(d+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Ct.fromBufferAttribute(e,t),Ct.normalize(),e.setXYZ(t,Ct.x,Ct.y,Ct.z)}toNonIndexed(){function e(a,c){let l=a.array,u=a.itemSize,h=a.normalized,d=new l.constructor(c.length*u),p=0,g=0;for(let x=0,m=c.length;x<m;x++){a.isInterleavedBufferAttribute?p=c[x]*a.data.stride+a.offset:p=c[x]*u;for(let f=0;f<u;f++)d[g++]=l[p++]}return new Mt(d,u,h)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let t=new i,n=this.index.array,s=this.attributes;for(let a in s){let c=s[a],l=e(c,n);t.setAttribute(a,l)}let r=this.morphAttributes;for(let a in r){let c=[],l=r[a];for(let u=0,h=l.length;u<h;u++){let d=l[u],p=e(d,n);c.push(p)}t.morphAttributes[a]=c}t.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,c=o.length;a<c;a++){let l=o[a];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){let e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){let c=this.parameters;for(let l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let c in n){let l=n[c];e.data.attributes[c]=l.toJSON(e.data)}let s={},r=!1;for(let c in this.morphAttributes){let l=this.morphAttributes[c],u=[];for(let h=0,d=l.length;h<d;h++){let p=l[h];u.push(p.toJSON(e.data))}u.length>0&&(s[c]=u,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let s=e.attributes;for(let l in s){let u=s[l];this.setAttribute(l,u.clone(t))}let r=e.morphAttributes;for(let l in r){let u=[],h=r[l];for(let d=0,p=h.length;d<p;d++)u.push(h[d].clone(t));this.morphAttributes[l]=u}this.morphTargetsRelative=e.morphTargetsRelative;let o=e.groups;for(let l=0,u=o.length;l<u;l++){let h=o[l];this.addGroup(h.start,h.count,h.materialIndex)}let a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());let c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}},dh=new Ve,xi=new Xn,uo=new Ot,fh=new L,ho=new L,fo=new L,po=new L,Wl=new L,mo=new L,ph=new L,go=new L,Qe=class extends ht{constructor(e=new _t,t=new Ft){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){let n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);let a=this.morphTargetInfluences;if(r&&a){mo.set(0,0,0);for(let c=0,l=r.length;c<l;c++){let u=a[c],h=r[c];u!==0&&(Wl.fromBufferAttribute(h,e),o?mo.addScaledVector(Wl,u):mo.addScaledVector(Wl.sub(t),u))}t.add(mo)}return t}raycast(e,t){let n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),uo.copy(n.boundingSphere),uo.applyMatrix4(r),xi.copy(e.ray).recast(e.near),!(uo.containsPoint(xi.origin)===!1&&(xi.intersectSphere(uo,fh)===null||xi.origin.distanceToSquared(fh)>(e.far-e.near)**2))&&(dh.copy(r).invert(),xi.copy(e.ray).applyMatrix4(dh),!(n.boundingBox!==null&&xi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,xi)))}_computeIntersections(e,t,n){let s,r=this.geometry,o=this.material,a=r.index,c=r.attributes.position,l=r.attributes.uv,u=r.attributes.uv1,h=r.attributes.normal,d=r.groups,p=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,x=d.length;g<x;g++){let m=d[g],f=o[m.materialIndex],T=Math.max(m.start,p.start),b=Math.min(a.count,Math.min(m.start+m.count,p.start+p.count));for(let M=T,A=b;M<A;M+=3){let E=a.getX(M),C=a.getX(M+1),D=a.getX(M+2);s=_o(this,f,e,n,l,u,h,E,C,D),s&&(s.faceIndex=Math.floor(M/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,p.start),x=Math.min(a.count,p.start+p.count);for(let m=g,f=x;m<f;m+=3){let T=a.getX(m),b=a.getX(m+1),M=a.getX(m+2);s=_o(this,o,e,n,l,u,h,T,b,M),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(c!==void 0)if(Array.isArray(o))for(let g=0,x=d.length;g<x;g++){let m=d[g],f=o[m.materialIndex],T=Math.max(m.start,p.start),b=Math.min(c.count,Math.min(m.start+m.count,p.start+p.count));for(let M=T,A=b;M<A;M+=3){let E=M,C=M+1,D=M+2;s=_o(this,f,e,n,l,u,h,E,C,D),s&&(s.faceIndex=Math.floor(M/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{let g=Math.max(0,p.start),x=Math.min(c.count,p.start+p.count);for(let m=g,f=x;m<f;m+=3){let T=m,b=m+1,M=m+2;s=_o(this,o,e,n,l,u,h,T,b,M),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}};function Pm(i,e,t,n,s,r,o,a){let c;if(e.side===Et?c=n.intersectTriangle(o,r,s,!0,a):c=n.intersectTriangle(s,r,o,e.side===xn,a),c===null)return null;go.copy(a),go.applyMatrix4(i.matrixWorld);let l=t.ray.origin.distanceTo(go);return l<t.near||l>t.far?null:{distance:l,point:go.clone(),object:i}}function _o(i,e,t,n,s,r,o,a,c,l){i.getVertexPosition(a,ho),i.getVertexPosition(c,fo),i.getVertexPosition(l,po);let u=Pm(i,e,t,n,ho,fo,po,ph);if(u){let h=new L;Gn.getBarycoord(ph,ho,fo,po,h),s&&(u.uv=Gn.getInterpolatedAttribute(s,a,c,l,h,new we)),r&&(u.uv1=Gn.getInterpolatedAttribute(r,a,c,l,h,new we)),o&&(u.normal=Gn.getInterpolatedAttribute(o,a,c,l,h,new L),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));let d={a,b:c,c:l,normal:new L,materialIndex:0};Gn.getNormal(ho,fo,po,d.normal),u.face=d,u.barycoord=h}return u}var ai=class i extends _t{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};let a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);let c=[],l=[],u=[],h=[],d=0,p=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(c),this.setAttribute("position",new it(l,3)),this.setAttribute("normal",new it(u,3)),this.setAttribute("uv",new it(h,2));function g(x,m,f,T,b,M,A,E,C,D,S){let y=M/C,P=A/D,F=M/2,k=A/2,H=E/2,q=C+1,W=D+1,te=0,V=0,oe=new L;for(let ce=0;ce<W;ce++){let Te=ce*P-k;for(let re=0;re<q;re++){let ae=re*y-F;oe[x]=ae*T,oe[m]=Te*b,oe[f]=H,l.push(oe.x,oe.y,oe.z),oe[x]=0,oe[m]=0,oe[f]=E>0?1:-1,u.push(oe.x,oe.y,oe.z),h.push(re/C),h.push(1-ce/D),te+=1}}for(let ce=0;ce<D;ce++)for(let Te=0;Te<C;Te++){let re=d+Te+q*ce,ae=d+Te+q*(ce+1),Oe=d+(Te+1)+q*(ce+1),Re=d+(Te+1)+q*ce;c.push(re,ae,Re),c.push(ae,Oe,Re),V+=6}a.addGroup(p,V,S),p+=V,d+=te}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}};function Bi(i){let e={};for(let t in i){e[t]={};for(let n in i[t]){let s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function zt(i){let e={};for(let t=0;t<i.length;t++){let n=Bi(i[t]);for(let s in n)e[s]=n[s]}return e}function Lm(i){let e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Cc(i){let e=i.getRenderTarget();return e===null?i.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Ke.workingColorSpace}var Rd={clone:Bi,merge:zt},Dm=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Nm=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,yn=class extends Ut{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Dm,this.fragmentShader=Nm,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Bi(e.uniforms),this.uniformsGroups=Lm(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let s in this.uniforms){let o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}},ur=class extends ht{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Ve,this.projectionMatrix=new Ve,this.projectionMatrixInverse=new Ve,this.coordinateSystem=gn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}},si=new L,mh=new we,gh=new we,vt=class extends ur{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=Ei*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(nr*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Ei*2*Math.atan(Math.tan(nr*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){si.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(si.x,si.y).multiplyScalar(-e/si.z),si.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(si.x,si.y).multiplyScalar(-e/si.z)}getViewSize(e,t){return this.getViewBounds(e,mh,gh),t.subVectors(gh,mh)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(nr*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s,o=this.view;if(this.view!==null&&this.view.enabled){let c=o.fullWidth,l=o.fullHeight;r+=o.offsetX*s/c,t-=o.offsetY*n/l,s*=o.width/c,n*=o.height/l}let a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},rs=-90,os=1,Fo=class extends ht{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let s=new vt(rs,os,e,t);s.layers=this.layers,this.add(s);let r=new vt(rs,os,e,t);r.layers=this.layers,this.add(r);let o=new vt(rs,os,e,t);o.layers=this.layers,this.add(o);let a=new vt(rs,os,e,t);a.layers=this.layers,this.add(a);let c=new vt(rs,os,e,t);c.layers=this.layers,this.add(c);let l=new vt(rs,os,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,c]=t;for(let l of t)this.remove(l);if(e===gn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===rr)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(let l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[r,o,a,c,l,u]=this.children,h=e.getRenderTarget(),d=e.getActiveCubeFace(),p=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;let x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,c),e.setRenderTarget(n,4,s),e.render(t,l),n.texture.generateMipmaps=x,e.setRenderTarget(n,5,s),e.render(t,u),e.setRenderTarget(h,d,p),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}},hr=class extends Tt{constructor(e=[],t=Oi,n,s,r,o,a,c,l,u){super(e,t,n,s,r,o,a,c,l,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},Bo=class extends Rn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];this.texture=new hr(s),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new ai(5,5,5),r=new yn({name:"CubemapFromEquirect",uniforms:Bi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Et,blending:Kn});r.uniforms.tEquirect.value=t;let o=new Qe(s,r),a=t.minFilter;return t.minFilter===Sn&&(t.minFilter=Vt),new Fo(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t=!0,n=!0,s=!0){let r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}},St=class extends ht{constructor(){super(),this.isGroup=!0,this.type="Group"}},Om={type:"move"},ys=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new St,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new St,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new L,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new L),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new St,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new L,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new L),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null,a=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){o=!0;for(let x of e.hand.values()){let m=t.getJointPose(x,n),f=this._getHandJoint(l,x);m!==null&&(f.matrix.fromArray(m.transform.matrix),f.matrix.decompose(f.position,f.rotation,f.scale),f.matrixWorldNeedsUpdate=!0,f.jointRadius=m.radius),f.visible=m!==null}let u=l.joints["index-finger-tip"],h=l.joints["thumb-tip"],d=u.position.distanceTo(h.position),p=.02,g=.005;l.inputState.pinching&&d>p+g?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&d<=p-g&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(c.matrix.fromArray(r.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,r.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(r.linearVelocity)):c.hasLinearVelocity=!1,r.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(r.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(Om)))}return a!==null&&(a.visible=s!==null),c!==null&&(c.visible=r!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new St;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}};var Ai=class extends ht{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new cn,this.environmentIntensity=1,this.environmentRotation=new cn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}},wi=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=Do,this.updateRanges=[],this.version=0,this.uuid=_n()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let s=0,r=this.stride;s<r;s++)this.array[e+s]=t.array[n+s];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}},Ht=new L,li=class i{constructor(e,t,n,s=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=s}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.applyMatrix4(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.applyNormalMatrix(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.transformDirection(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=mn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ot(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=mn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=mn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=mn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=mn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),s=ot(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),s=ot(s,this.array),r=ot(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=s,this.data.array[e+3]=r,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return new Mt(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new i(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let t=[];for(let n=0;n<this.count;n++){let s=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[s+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},vs=class extends Ut{constructor(e){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new Pe(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.rotation=e.rotation,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},as,js=new L,ls=new L,cs=new L,us=new we,Ks=new we,Cd=new Ve,xo=new L,Zs=new L,yo=new L,_h=new we,Xl=new we,xh=new we,dr=class extends ht{constructor(e=new vs){if(super(),this.isSprite=!0,this.type="Sprite",as===void 0){as=new _t;let t=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new wi(t,5);as.setIndex([0,1,2,0,2,3]),as.setAttribute("position",new li(n,3,0,!1)),as.setAttribute("uv",new li(n,2,3,!1))}this.geometry=as,this.material=e,this.center=new we(.5,.5),this.count=1}raycast(e,t){e.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),ls.setFromMatrixScale(this.matrixWorld),Cd.copy(e.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(e.camera.matrixWorldInverse,this.matrixWorld),cs.setFromMatrixPosition(this.modelViewMatrix),e.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&ls.multiplyScalar(-cs.z);let n=this.material.rotation,s,r;n!==0&&(r=Math.cos(n),s=Math.sin(n));let o=this.center;vo(xo.set(-.5,-.5,0),cs,o,ls,s,r),vo(Zs.set(.5,-.5,0),cs,o,ls,s,r),vo(yo.set(.5,.5,0),cs,o,ls,s,r),_h.set(0,0),Xl.set(1,0),xh.set(1,1);let a=e.ray.intersectTriangle(xo,Zs,yo,!1,js);if(a===null&&(vo(Zs.set(-.5,.5,0),cs,o,ls,s,r),Xl.set(0,1),a=e.ray.intersectTriangle(xo,yo,Zs,!1,js),a===null))return;let c=e.ray.origin.distanceTo(js);c<e.near||c>e.far||t.push({distance:c,point:js.clone(),uv:Gn.getInterpolation(js,xo,Zs,yo,_h,Xl,xh,new we),face:null,object:this})}copy(e,t){return super.copy(e,t),e.center!==void 0&&this.center.copy(e.center),this.material=e.material,this}};function vo(i,e,t,n,s,r){us.subVectors(i,t).addScalar(.5).multiply(n),s!==void 0?(Ks.x=r*us.x-s*us.y,Ks.y=s*us.x+r*us.y):Ks.copy(us),i.copy(e),i.x+=Ks.x,i.y+=Ks.y,i.applyMatrix4(Cd)}var yh=new L,vh=new Je,Sh=new Je,Um=new L,Mh=new Ve,So=new L,Yl=new Ot,bh=new Ve,ql=new Xn,fr=class extends Qe{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=ec,this.bindMatrix=new Ve,this.bindMatrixInverse=new Ve,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new Wt),this.boundingBox.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,So),this.boundingBox.expandByPoint(So)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new Ot),this.boundingSphere.makeEmpty();let t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,So),this.boundingSphere.expandByPoint(So)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){let n=this.material,s=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Yl.copy(this.boundingSphere),Yl.applyMatrix4(s),e.ray.intersectsSphere(Yl)!==!1&&(bh.copy(s).invert(),ql.copy(e.ray).applyMatrix4(bh),!(this.boundingBox!==null&&ql.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,ql)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new Je,t=this.geometry.attributes.skinWeight;for(let n=0,s=t.count;n<s;n++){e.fromBufferAttribute(t,n);let r=1/e.manhattanLength();r!==1/0?e.multiplyScalar(r):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===ec?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===fd?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,s=this.geometry;vh.fromBufferAttribute(s.attributes.skinIndex,e),Sh.fromBufferAttribute(s.attributes.skinWeight,e),yh.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let r=0;r<4;r++){let o=Sh.getComponent(r);if(o!==0){let a=vh.getComponent(r);Mh.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),t.addScaledVector(Um.copy(yh).applyMatrix4(Mh),o)}}return t.applyMatrix4(this.bindMatrixInverse)}},Ss=class extends ht{constructor(){super(),this.isBone=!0,this.type="Bone"}},pr=class extends Tt{constructor(e=null,t=1,n=1,s,r,o,a,c,l=Pt,u=Pt,h,d){super(null,o,a,c,l,u,s,r,h,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Th=new Ve,Fm=new Ve,mr=class i{constructor(e=[],t=[]){this.uuid=_n(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,s=this.bones.length;n<s;n++)this.boneInverses.push(new Ve)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let n=new Ve;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,s=this.boneTexture;for(let r=0,o=e.length;r<o;r++){let a=e[r]?e[r].matrixWorld:Fm;Th.multiplyMatrices(a,t[r]),Th.toArray(n,r*16)}s!==null&&(s.needsUpdate=!0)}clone(){return new i(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new pr(t,e,e,tn,un);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let s=this.bones[t];if(s.name===e)return s}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,s=e.bones.length;n<s;n++){let r=e.bones[n],o=t[r];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",r),o=new Ss),this.bones.push(o),this.boneInverses.push(new Ve().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let s=0,r=t.length;s<r;s++){let o=t[s];e.bones.push(o.uuid);let a=n[s];e.boneInverses.push(a.toArray())}return e}},ci=class extends Mt{constructor(e,t,n,s=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=s}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},hs=new Ve,Eh=new Ve,Mo=[],Ah=new Wt,Bm=new Ve,Js=new Qe,Qs=new Ot,Ri=class extends Qe{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new ci(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let s=0;s<n;s++)this.setMatrixAt(s,Bm)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Wt),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,hs),Ah.copy(e.boundingBox).applyMatrix4(hs),this.boundingBox.union(Ah)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new Ot),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,hs),Qs.copy(e.boundingSphere).applyMatrix4(hs),this.boundingSphere.union(Qs)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,s=this.morphTexture.source.data.data,r=n.length+1,o=e*r+1;for(let a=0;a<n.length;a++)n[a]=s[o+a]}raycast(e,t){let n=this.matrixWorld,s=this.count;if(Js.geometry=this.geometry,Js.material=this.material,Js.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Qs.copy(this.boundingSphere),Qs.applyMatrix4(n),e.ray.intersectsSphere(Qs)!==!1))for(let r=0;r<s;r++){this.getMatrixAt(r,hs),Eh.multiplyMatrices(n,hs),Js.matrixWorld=Eh,Js.raycast(e,Mo);for(let o=0,a=Mo.length;o<a;o++){let c=Mo[o];c.instanceId=r,c.object=this,t.push(c)}Mo.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new ci(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){let n=t.morphTargetInfluences,s=n.length+1;this.morphTexture===null&&(this.morphTexture=new pr(new Float32Array(s*this.count),s,this.count,fa,un));let r=this.morphTexture.source.data.data,o=0;for(let l=0;l<n.length;l++)o+=n[l];let a=this.geometry.morphTargetsRelative?1:1-o,c=s*e;r[c]=a,r.set(n,c+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},$l=new L,zm=new L,km=new Ge,ln=class{constructor(e=new L(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let s=$l.subVectors(n,t).cross(zm.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){let n=e.delta($l),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||km.getNormalMatrix(e),s=this.coplanarPoint($l).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}},yi=new Ot,Hm=new we(.5,.5),bo=new L,Ms=class{constructor(e=new ln,t=new ln,n=new ln,s=new ln,r=new ln,o=new ln){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){let a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=gn,n=!1){let s=this.planes,r=e.elements,o=r[0],a=r[1],c=r[2],l=r[3],u=r[4],h=r[5],d=r[6],p=r[7],g=r[8],x=r[9],m=r[10],f=r[11],T=r[12],b=r[13],M=r[14],A=r[15];if(s[0].setComponents(l-o,p-u,f-g,A-T).normalize(),s[1].setComponents(l+o,p+u,f+g,A+T).normalize(),s[2].setComponents(l+a,p+h,f+x,A+b).normalize(),s[3].setComponents(l-a,p-h,f-x,A-b).normalize(),n)s[4].setComponents(c,d,m,M).normalize(),s[5].setComponents(l-c,p-d,f-m,A-M).normalize();else if(s[4].setComponents(l-c,p-d,f-m,A-M).normalize(),t===gn)s[5].setComponents(l+c,p+d,f+m,A+M).normalize();else if(t===rr)s[5].setComponents(c,d,m,M).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),yi.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),yi.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(yi)}intersectsSprite(e){yi.center.set(0,0,0);let t=Hm.distanceTo(e.center);return yi.radius=.7071067811865476+t,yi.applyMatrix4(e.matrixWorld),this.intersectsSphere(yi)}intersectsSphere(e){let t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let s=t[n];if(bo.x=s.normal.x>0?e.max.x:e.min.x,bo.y=s.normal.y>0?e.max.y:e.min.y,bo.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(bo)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}};var vn=class extends Ut{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Pe(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},zo=new L,ko=new L,wh=new Ve,er=new Xn,To=new Ot,jl=new L,Rh=new L,Cn=class extends ht{constructor(e=new _t,t=new vn){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let s=1,r=t.count;s<r;s++)zo.fromBufferAttribute(t,s-1),ko.fromBufferAttribute(t,s),n[s]=n[s-1],n[s]+=zo.distanceTo(ko);e.setAttribute("lineDistance",new it(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),To.copy(n.boundingSphere),To.applyMatrix4(s),To.radius+=r,e.ray.intersectsSphere(To)===!1)return;wh.copy(s).invert(),er.copy(e.ray).applyMatrix4(wh);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=this.isLineSegments?2:1,u=n.index,d=n.attributes.position;if(u!==null){let p=Math.max(0,o.start),g=Math.min(u.count,o.start+o.count);for(let x=p,m=g-1;x<m;x+=l){let f=u.getX(x),T=u.getX(x+1),b=Eo(this,e,er,c,f,T,x);b&&t.push(b)}if(this.isLineLoop){let x=u.getX(g-1),m=u.getX(p),f=Eo(this,e,er,c,x,m,g-1);f&&t.push(f)}}else{let p=Math.max(0,o.start),g=Math.min(d.count,o.start+o.count);for(let x=p,m=g-1;x<m;x+=l){let f=Eo(this,e,er,c,x,x+1,x);f&&t.push(f)}if(this.isLineLoop){let x=Eo(this,e,er,c,g-1,p,g-1);x&&t.push(x)}}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}};function Eo(i,e,t,n,s,r,o){let a=i.geometry.attributes.position;if(zo.fromBufferAttribute(a,s),ko.fromBufferAttribute(a,r),t.distanceSqToSegment(zo,ko,jl,Rh)>n)return;jl.applyMatrix4(i.matrixWorld);let l=e.ray.origin.distanceTo(jl);if(!(l<e.near||l>e.far))return{distance:l,point:Rh.clone().applyMatrix4(i.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:i}}var Ch=new L,Ih=new L,Ci=class extends Cn{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let s=0,r=t.count;s<r;s+=2)Ch.fromBufferAttribute(t,s),Ih.fromBufferAttribute(t,s+1),n[s]=s===0?0:n[s-1],n[s+1]=n[s]+Ch.distanceTo(Ih);e.setAttribute("lineDistance",new it(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},gr=class extends Cn{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}},bs=class extends Ut{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Pe(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Ph=new Ve,rc=new Xn,Ao=new Ot,wo=new L,_r=class extends ht{constructor(e=new _t,t=new bs){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){let n=this.geometry,s=this.matrixWorld,r=e.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ao.copy(n.boundingSphere),Ao.applyMatrix4(s),Ao.radius+=r,e.ray.intersectsSphere(Ao)===!1)return;Ph.copy(s).invert(),rc.copy(e.ray).applyMatrix4(Ph);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,h=n.attributes.position;if(l!==null){let d=Math.max(0,o.start),p=Math.min(l.count,o.start+o.count);for(let g=d,x=p;g<x;g++){let m=l.getX(g);wo.fromBufferAttribute(h,m),Lh(wo,m,c,s,e,t,this)}}else{let d=Math.max(0,o.start),p=Math.min(h.count,o.start+o.count);for(let g=d,x=p;g<x;g++)wo.fromBufferAttribute(h,g),Lh(wo,g,c,s,e,t,this)}}updateMorphTargets(){let t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){let s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){let a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}};function Lh(i,e,t,n,s,r,o){let a=rc.distanceSqToPoint(i);if(a<t){let c=new L;rc.closestPointToPoint(i,c),c.applyMatrix4(n);let l=s.ray.origin.distanceTo(c);if(l<s.near||l>s.far)return;r.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:e,face:null,faceIndex:null,barycoord:null,object:o})}}var xr=class extends Tt{constructor(e,t,n,s,r,o,a,c,l){super(e,t,n,s,r,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}},yr=class extends Tt{constructor(e,t,n=di,s,r,o,a=Pt,c=Pt,l,u=ms,h=1){if(u!==ms&&u!==Is)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let d={width:e,height:t,depth:h};super(d,s,r,o,a,c,u,n,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new xs(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}},vr=class extends Tt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Sr=class i extends _t{constructor(e=1,t=1,n=4,s=8,r=1){super(),this.type="CapsuleGeometry",this.parameters={radius:e,height:t,capSegments:n,radialSegments:s,heightSegments:r},t=Math.max(0,t),n=Math.max(1,Math.floor(n)),s=Math.max(3,Math.floor(s)),r=Math.max(1,Math.floor(r));let o=[],a=[],c=[],l=[],u=t/2,h=Math.PI/2*e,d=t,p=2*h+d,g=n*2+r,x=s+1,m=new L,f=new L;for(let T=0;T<=g;T++){let b=0,M=0,A=0,E=0;if(T<=n){let S=T/n,y=S*Math.PI/2;M=-u-e*Math.cos(y),A=e*Math.sin(y),E=-e*Math.cos(y),b=S*h}else if(T<=n+r){let S=(T-n)/r;M=-u+S*t,A=e,E=0,b=h+S*d}else{let S=(T-n-r)/n,y=S*Math.PI/2;M=u+e*Math.sin(y),A=e*Math.cos(y),E=e*Math.sin(y),b=h+d+S*h}let C=Math.max(0,Math.min(1,b/p)),D=0;T===0?D=.5/s:T===g&&(D=-.5/s);for(let S=0;S<=s;S++){let y=S/s,P=y*Math.PI*2,F=Math.sin(P),k=Math.cos(P);f.x=-A*k,f.y=M,f.z=A*F,a.push(f.x,f.y,f.z),m.set(-A*k,E,A*F),m.normalize(),c.push(m.x,m.y,m.z),l.push(y+D,C)}if(T>0){let S=(T-1)*x;for(let y=0;y<s;y++){let P=S+y,F=S+y+1,k=T*x+y,H=T*x+y+1;o.push(P,F,k),o.push(F,H,k)}}}this.setIndex(o),this.setAttribute("position",new it(a,3)),this.setAttribute("normal",new it(c,3)),this.setAttribute("uv",new it(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.height,e.capSegments,e.radialSegments,e.heightSegments)}};var Ho=class i extends _t{constructor(e=1,t=1,n=1,s=32,r=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:c};let l=this;s=Math.floor(s),r=Math.floor(r);let u=[],h=[],d=[],p=[],g=0,x=[],m=n/2,f=0;T(),o===!1&&(e>0&&b(!0),t>0&&b(!1)),this.setIndex(u),this.setAttribute("position",new it(h,3)),this.setAttribute("normal",new it(d,3)),this.setAttribute("uv",new it(p,2));function T(){let M=new L,A=new L,E=0,C=(t-e)/n;for(let D=0;D<=r;D++){let S=[],y=D/r,P=y*(t-e)+e;for(let F=0;F<=s;F++){let k=F/s,H=k*c+a,q=Math.sin(H),W=Math.cos(H);A.x=P*q,A.y=-y*n+m,A.z=P*W,h.push(A.x,A.y,A.z),M.set(q,C,W).normalize(),d.push(M.x,M.y,M.z),p.push(k,1-y),S.push(g++)}x.push(S)}for(let D=0;D<s;D++)for(let S=0;S<r;S++){let y=x[S][D],P=x[S+1][D],F=x[S+1][D+1],k=x[S][D+1];(e>0||S!==0)&&(u.push(y,P,k),E+=3),(t>0||S!==r-1)&&(u.push(P,F,k),E+=3)}l.addGroup(f,E,0),f+=E}function b(M){let A=g,E=new we,C=new L,D=0,S=M===!0?e:t,y=M===!0?1:-1;for(let F=1;F<=s;F++)h.push(0,m*y,0),d.push(0,y,0),p.push(.5,.5),g++;let P=g;for(let F=0;F<=s;F++){let H=F/s*c+a,q=Math.cos(H),W=Math.sin(H);C.x=S*W,C.y=m*y,C.z=S*q,h.push(C.x,C.y,C.z),d.push(0,y,0),E.x=q*.5+.5,E.y=W*.5*y+.5,p.push(E.x,E.y),g++}for(let F=0;F<s;F++){let k=A+F,H=P+F;M===!0?u.push(H,H+1,k):u.push(H+1,H,k),D+=3}l.addGroup(f,D,M===!0?1:2),f+=D}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}},Vo=class i extends Ho{constructor(e=1,t=1,n=32,s=1,r=!1,o=0,a=Math.PI*2){super(0,e,t,n,s,r,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:o,thetaLength:a}}static fromJSON(e){return new i(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}};var Mr=class i extends _t{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};let r=e/2,o=t/2,a=Math.floor(n),c=Math.floor(s),l=a+1,u=c+1,h=e/a,d=t/c,p=[],g=[],x=[],m=[];for(let f=0;f<u;f++){let T=f*d-o;for(let b=0;b<l;b++){let M=b*h-r;g.push(M,-T,0),x.push(0,0,1),m.push(b/a),m.push(1-f/c)}}for(let f=0;f<c;f++)for(let T=0;T<a;T++){let b=T+l*f,M=T+l*(f+1),A=T+1+l*(f+1),E=T+1+l*f;p.push(b,M,E),p.push(M,A,E)}this.setIndex(p),this.setAttribute("position",new it(g,3)),this.setAttribute("normal",new it(x,3)),this.setAttribute("uv",new it(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.width,e.height,e.widthSegments,e.heightSegments)}};var Ii=class i extends _t{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let c=Math.min(o+a,Math.PI),l=0,u=[],h=new L,d=new L,p=[],g=[],x=[],m=[];for(let f=0;f<=n;f++){let T=[],b=f/n,M=0;f===0&&o===0?M=.5/t:f===n&&c===Math.PI&&(M=-.5/t);for(let A=0;A<=t;A++){let E=A/t;h.x=-e*Math.cos(s+E*r)*Math.sin(o+b*a),h.y=e*Math.cos(o+b*a),h.z=e*Math.sin(s+E*r)*Math.sin(o+b*a),g.push(h.x,h.y,h.z),d.copy(h).normalize(),x.push(d.x,d.y,d.z),m.push(E+M,1-b),T.push(l++)}u.push(T)}for(let f=0;f<n;f++)for(let T=0;T<t;T++){let b=u[f][T+1],M=u[f][T],A=u[f+1][T],E=u[f+1][T+1];(f!==0||o>0)&&p.push(b,M,E),(f!==n-1||c<Math.PI)&&p.push(M,A,E)}this.setIndex(p),this.setAttribute("position",new it(g,3)),this.setAttribute("normal",new it(x,3)),this.setAttribute("uv",new it(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new i(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}};var Yt=class extends Ut{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Pe(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Xa,this.normalScale=new we(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},qt=class extends Yt{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new we(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Xe(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Pe(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Pe(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Pe(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}};var br=class extends Ut{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new Pe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Xa,this.normalScale=new we(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new cn,this.combine=ra,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Go=class extends Ut{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=md,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Wo=class extends Ut{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function Ro(i,e){return!i||i.constructor===e?i:typeof e.BYTES_PER_ELEMENT=="number"?new e(i):Array.prototype.slice.call(i)}function Vm(i){return ArrayBuffer.isView(i)&&!(i instanceof DataView)}function Gm(i){function e(s,r){return i[s]-i[r]}let t=i.length,n=new Array(t);for(let s=0;s!==t;++s)n[s]=s;return n.sort(e),n}function Dh(i,e,t){let n=i.length,s=new i.constructor(n);for(let r=0,o=0;o!==n;++r){let a=t[r]*e;for(let c=0;c!==e;++c)s[o++]=i[a+c]}return s}function Id(i,e,t,n){let s=1,r=i[0];for(;r!==void 0&&r[n]===void 0;)r=i[s++];if(r===void 0)return;let o=r[n];if(o!==void 0)if(Array.isArray(o))do o=r[n],o!==void 0&&(e.push(r.time),t.push(...o)),r=i[s++];while(r!==void 0);else if(o.toArray!==void 0)do o=r[n],o!==void 0&&(e.push(r.time),o.toArray(t,t.length)),r=i[s++];while(r!==void 0);else do o=r[n],o!==void 0&&(e.push(r.time),t.push(o)),r=i[s++];while(r!==void 0)}var Yn=class{constructor(e,t,n,s){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=s!==void 0?s:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,s=t[n],r=t[n-1];n:{e:{let o;t:{i:if(!(e<s)){for(let a=n+2;;){if(s===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=s,s=t[++n],e<s)break e}o=t.length;break t}if(!(e>=r)){let a=t[1];e<a&&(n=2,r=a);for(let c=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(s=r,r=t[--n-1],e>=r)break e}o=n,n=0;break t}break n}for(;n<o;){let a=n+o>>>1;e<t[a]?o=a:n=a+1}if(s=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(s===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,s)}return this.interpolate_(n,r,e,s)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s;for(let o=0;o!==s;++o)t[o]=n[r+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}},Xo=class extends Yn{constructor(e,t,n,s){super(e,t,n,s),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:tc,endingEnd:tc}}intervalChanged_(e,t,n){let s=this.parameterPositions,r=e-2,o=e+1,a=s[r],c=s[o];if(a===void 0)switch(this.getSettings_().endingStart){case nc:r=e,a=2*t-n;break;case ic:r=s.length-2,a=t+s[r]-s[r+1];break;default:r=e,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case nc:o=e,c=2*n-t;break;case ic:o=1,c=n+s[1]-s[0];break;default:o=e-1,c=t}let l=(n-t)*.5,u=this.valueSize;this._weightPrev=l/(t-a),this._weightNext=l/(c-n),this._offsetPrev=r*u,this._offsetNext=o*u}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,u=this._offsetPrev,h=this._offsetNext,d=this._weightPrev,p=this._weightNext,g=(n-t)/(s-t),x=g*g,m=x*g,f=-d*m+2*d*x-d*g,T=(1+d)*m+(-1.5-2*d)*x+(-.5+d)*g+1,b=(-1-p)*m+(1.5+p)*x+.5*g,M=p*m-p*x;for(let A=0;A!==a;++A)r[A]=f*o[u+A]+T*o[l+A]+b*o[c+A]+M*o[h+A];return r}},Yo=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,u=(n-t)/(s-t),h=1-u;for(let d=0;d!==a;++d)r[d]=o[l+d]*h+o[c+d]*u;return r}},qo=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e){return this.copySampleValue_(e-1)}},$t=class{constructor(e,t,n,s){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=Ro(t,this.TimeBufferType),this.values=Ro(n,this.ValueBufferType),this.setInterpolation(s||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Ro(e.times,Array),values:Ro(e.values,Array)};let s=e.getInterpolation();s!==e.DefaultInterpolation&&(n.interpolation=s)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new qo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new Yo(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Xo(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case bi:t=this.InterpolantFactoryMethodDiscrete;break;case Ti:t=this.InterpolantFactoryMethodLinear;break;case Io:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return bi;case this.InterpolantFactoryMethodLinear:return Ti;case this.InterpolantFactoryMethodSmooth:return Io}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,s=t.length;n!==s;++n)t[n]*=e}return this}trim(e,t){let n=this.times,s=n.length,r=0,o=s-1;for(;r!==s&&n[r]<e;)++r;for(;o!==-1&&n[o]>t;)--o;if(++o,r!==0||o!==s){r>=o&&(o=Math.max(o,1),r=o-1);let a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);let n=this.times,s=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==r;a++){let c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),e=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),e=!1;break}o=c}if(s!==void 0&&Vm(s))for(let a=0,c=s.length;a!==c;++a){let l=s[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),s=this.getInterpolation()===Io,r=e.length-1,o=1;for(let a=1;a<r;++a){let c=!1,l=e[a],u=e[a+1];if(l!==u&&(a!==1||l!==e[0]))if(s)c=!0;else{let h=a*n,d=h-n,p=h+n;for(let g=0;g!==n;++g){let x=t[h+g];if(x!==t[d+g]||x!==t[p+g]){c=!0;break}}}if(c){if(a!==o){e[o]=e[a];let h=a*n,d=o*n;for(let p=0;p!==n;++p)t[d+p]=t[h+p]}++o}}if(r>0){e[o]=e[r];for(let a=r*n,c=o*n,l=0;l!==n;++l)t[c+l]=t[a+l];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,s=new n(this.name,e,t);return s.createInterpolant=this.createInterpolant,s}};$t.prototype.ValueTypeName="";$t.prototype.TimeBufferType=Float32Array;$t.prototype.ValueBufferType=Float32Array;$t.prototype.DefaultInterpolation=Ti;var qn=class extends $t{constructor(e,t,n){super(e,t,n)}};qn.prototype.ValueTypeName="bool";qn.prototype.ValueBufferType=Array;qn.prototype.DefaultInterpolation=bi;qn.prototype.InterpolantFactoryMethodLinear=void 0;qn.prototype.InterpolantFactoryMethodSmooth=void 0;var Tr=class extends $t{constructor(e,t,n,s){super(e,t,n,s)}};Tr.prototype.ValueTypeName="color";var In=class extends $t{constructor(e,t,n,s){super(e,t,n,s)}};In.prototype.ValueTypeName="number";var $o=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-t)/(s-t),l=e*a;for(let u=l+a;l!==u;l+=4)Gt.slerpFlat(r,0,o,l-a,o,l,c);return r}},Pn=class extends $t{constructor(e,t,n,s){super(e,t,n,s)}InterpolantFactoryMethodLinear(e){return new $o(this.times,this.values,this.getValueSize(),e)}};Pn.prototype.ValueTypeName="quaternion";Pn.prototype.InterpolantFactoryMethodSmooth=void 0;var $n=class extends $t{constructor(e,t,n){super(e,t,n)}};$n.prototype.ValueTypeName="string";$n.prototype.ValueBufferType=Array;$n.prototype.DefaultInterpolation=bi;$n.prototype.InterpolantFactoryMethodLinear=void 0;$n.prototype.InterpolantFactoryMethodSmooth=void 0;var Ln=class extends $t{constructor(e,t,n,s){super(e,t,n,s)}};Ln.prototype.ValueTypeName="vector";var Er=class{constructor(e="",t=-1,n=[],s=pd){this.name=e,this.tracks=n,this.duration=t,this.blendMode=s,this.uuid=_n(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,s=1/(e.fps||1);for(let o=0,a=n.length;o!==a;++o)t.push(Xm(n[o]).scale(s));let r=new this(e.name,e.duration,t,e.blendMode);return r.uuid=e.uuid,r.userData=JSON.parse(e.userData||"{}"),r}static toJSON(e){let t=[],n=e.tracks,s={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let r=0,o=n.length;r!==o;++r)t.push($t.toJSON(n[r]));return s}static CreateFromMorphTargetSequence(e,t,n,s){let r=t.length,o=[];for(let a=0;a<r;a++){let c=[],l=[];c.push((a+r-1)%r,a,(a+1)%r),l.push(0,1,0);let u=Gm(c);c=Dh(c,1,u),l=Dh(l,1,u),!s&&c[0]===0&&(c.push(r),l.push(l[0])),o.push(new In(".morphTargetInfluences["+t[a].name+"]",c,l).scale(1/n))}return new this(e,-1,o)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let s=e;n=s.geometry&&s.geometry.animations||s.animations}for(let s=0;s<n.length;s++)if(n[s].name===t)return n[s];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let s={},r=/^([\w-]*?)([\d]+)$/;for(let a=0,c=e.length;a<c;a++){let l=e[a],u=l.name.match(r);if(u&&u.length>1){let h=u[1],d=s[h];d||(s[h]=d=[]),d.push(l)}}let o=[];for(let a in s)o.push(this.CreateFromMorphTargetSequence(a,s[a],t,n));return o}static parseAnimation(e,t){if(console.warn("THREE.AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;let n=function(h,d,p,g,x){if(p.length!==0){let m=[],f=[];Id(p,m,f,g),m.length!==0&&x.push(new h(d,m,f))}},s=[],r=e.name||"default",o=e.fps||30,a=e.blendMode,c=e.length||-1,l=e.hierarchy||[];for(let h=0;h<l.length;h++){let d=l[h].keys;if(!(!d||d.length===0))if(d[0].morphTargets){let p={},g;for(g=0;g<d.length;g++)if(d[g].morphTargets)for(let x=0;x<d[g].morphTargets.length;x++)p[d[g].morphTargets[x]]=-1;for(let x in p){let m=[],f=[];for(let T=0;T!==d[g].morphTargets.length;++T){let b=d[g];m.push(b.time),f.push(b.morphTarget===x?1:0)}s.push(new In(".morphTargetInfluence["+x+"]",m,f))}c=p.length*o}else{let p=".bones["+t[h].name+"]";n(Ln,p+".position",d,"pos",s),n(Pn,p+".quaternion",d,"rot",s),n(Ln,p+".scale",d,"scl",s)}}return s.length===0?null:new this(r,c,s,a)}resetDuration(){let e=this.tracks,t=0;for(let n=0,s=e.length;n!==s;++n){let r=this.tracks[n];t=Math.max(t,r.times[r.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let n=0;n<this.tracks.length;n++)e.push(this.tracks[n].clone());let t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}};function Wm(i){switch(i.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return In;case"vector":case"vector2":case"vector3":case"vector4":return Ln;case"color":return Tr;case"quaternion":return Pn;case"bool":case"boolean":return qn;case"string":return $n}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+i)}function Xm(i){if(i.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let e=Wm(i.type);if(i.times===void 0){let t=[],n=[];Id(i.keys,t,n,"value"),i.times=t,i.values=n}return e.parse!==void 0?e.parse(i):new e(i.name,i.times,i.values,i.interpolation)}var An={enabled:!1,files:{},add:function(i,e){this.enabled!==!1&&(this.files[i]=e)},get:function(i){if(this.enabled!==!1)return this.files[i]},remove:function(i){delete this.files[i]},clear:function(){this.files={}}},jo=class{constructor(e,t,n){let s=this,r=!1,o=0,a=0,c,l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.abortController=new AbortController,this.itemStart=function(u){a++,r===!1&&s.onStart!==void 0&&s.onStart(u,o,a),r=!0},this.itemEnd=function(u){o++,s.onProgress!==void 0&&s.onProgress(u,o,a),o===a&&(r=!1,s.onLoad!==void 0&&s.onLoad())},this.itemError=function(u){s.onError!==void 0&&s.onError(u)},this.resolveURL=function(u){return c?c(u):u},this.setURLModifier=function(u){return c=u,this},this.addHandler=function(u,h){return l.push(u,h),this},this.removeHandler=function(u){let h=l.indexOf(u);return h!==-1&&l.splice(h,2),this},this.getHandler=function(u){for(let h=0,d=l.length;h<d;h+=2){let p=l[h],g=l[h+1];if(p.global&&(p.lastIndex=0),p.test(u))return g}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}},Pd=new jo,Dn=class{constructor(e){this.manager=e!==void 0?e:Pd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){let n=this;return new Promise(function(s,r){n.load(e,s,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Dn.DEFAULT_MATERIAL_NAME="__DEFAULT";var Vn={},oc=class extends Error{constructor(e,t){super(e),this.response=t}},Ts=class extends Dn{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=An.get(`file:${e}`);if(r!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(r),this.manager.itemEnd(e)},0),r;if(Vn[e]!==void 0){Vn[e].push({onLoad:t,onProgress:n,onError:s});return}Vn[e]=[],Vn[e].push({onLoad:t,onProgress:n,onError:s});let o=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;let u=Vn[e],h=l.body.getReader(),d=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),p=d?parseInt(d):0,g=p!==0,x=0,m=new ReadableStream({start(f){T();function T(){h.read().then(({done:b,value:M})=>{if(b)f.close();else{x+=M.byteLength;let A=new ProgressEvent("progress",{lengthComputable:g,loaded:x,total:p});for(let E=0,C=u.length;E<C;E++){let D=u[E];D.onProgress&&D.onProgress(A)}f.enqueue(M),T()}},b=>{f.error(b)})}}});return new Response(m)}else throw new oc(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(u=>new DOMParser().parseFromString(u,a));case"json":return l.json();default:if(a==="")return l.text();{let h=/charset="?([^;"\s]*)"?/i.exec(a),d=h&&h[1]?h[1].toLowerCase():void 0,p=new TextDecoder(d);return l.arrayBuffer().then(g=>p.decode(g))}}}).then(l=>{An.add(`file:${e}`,l);let u=Vn[e];delete Vn[e];for(let h=0,d=u.length;h<d;h++){let p=u[h];p.onLoad&&p.onLoad(l)}}).catch(l=>{let u=Vn[e];if(u===void 0)throw this.manager.itemError(e),l;delete Vn[e];for(let h=0,d=u.length;h<d;h++){let p=u[h];p.onError&&p.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}};var ds=new WeakMap,Ko=class extends Dn{constructor(e){super(e)}load(e,t,n,s){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,o=An.get(`image:${e}`);if(o!==void 0){if(o.complete===!0)r.manager.itemStart(e),setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0);else{let h=ds.get(o);h===void 0&&(h=[],ds.set(o,h)),h.push({onLoad:t,onError:s})}return o}let a=gs("img");function c(){u(),t&&t(this);let h=ds.get(this)||[];for(let d=0;d<h.length;d++){let p=h[d];p.onLoad&&p.onLoad(this)}ds.delete(this),r.manager.itemEnd(e)}function l(h){u(),s&&s(h),An.remove(`image:${e}`);let d=ds.get(this)||[];for(let p=0;p<d.length;p++){let g=d[p];g.onError&&g.onError(h)}ds.delete(this),r.manager.itemError(e),r.manager.itemEnd(e)}function u(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),An.add(`image:${e}`,a),r.manager.itemStart(e),a.src=e,a}};var Ar=class extends Dn{constructor(e){super(e)}load(e,t,n,s){let r=new Tt,o=new Ko(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(e,function(a){r.image=a,r.needsUpdate=!0,t!==void 0&&t(r)},n,s),r}},Pi=class extends ht{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Pe(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}};var Kl=new Ve,Nh=new L,Oh=new L,wr=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new we(512,512),this.mapType=Mn,this.map=null,this.mapPass=null,this.matrix=new Ve,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ms,this._frameExtents=new we(1,1),this._viewportCount=1,this._viewports=[new Je(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera,n=this.matrix;Nh.setFromMatrixPosition(e.matrixWorld),t.position.copy(Nh),Oh.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Oh),t.updateMatrixWorld(),Kl.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Kl,t.coordinateSystem,t.reversedDepth),t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Kl)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},ac=class extends wr{constructor(){super(new vt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=Ei*2*e.angle*this.focus,s=this.mapSize.width/this.mapSize.height*this.aspect,r=e.distance||t.far;(n!==t.fov||s!==t.aspect||r!==t.far)&&(t.fov=n,t.aspect=s,t.far=r,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}},Rr=class extends Pi{constructor(e,t,n=0,s=Math.PI/3,r=0,o=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(ht.DEFAULT_UP),this.updateMatrix(),this.target=new ht,this.distance=n,this.angle=s,this.penumbra=r,this.decay=o,this.map=null,this.shadow=new ac}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},Uh=new Ve,tr=new L,Zl=new L,lc=class extends wr{constructor(){super(new vt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new we(4,2),this._viewportCount=6,this._viewports=[new Je(2,1,1,1),new Je(0,1,1,1),new Je(3,1,1,1),new Je(1,1,1,1),new Je(3,0,1,1),new Je(1,0,1,1)],this._cubeDirections=[new L(1,0,0),new L(-1,0,0),new L(0,0,1),new L(0,0,-1),new L(0,1,0),new L(0,-1,0)],this._cubeUps=[new L(0,1,0),new L(0,1,0),new L(0,1,0),new L(0,1,0),new L(0,0,1),new L(0,0,-1)]}updateMatrices(e,t=0){let n=this.camera,s=this.matrix,r=e.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),tr.setFromMatrixPosition(e.matrixWorld),n.position.copy(tr),Zl.copy(n.position),Zl.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Zl),n.updateMatrixWorld(),s.makeTranslation(-tr.x,-tr.y,-tr.z),Uh.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Uh,n.coordinateSystem,n.reversedDepth)}},Li=class extends Pi{constructor(e,t,n=0,s=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=s,this.shadow=new lc}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}},Di=class extends ur{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2,r=n-e,o=n+e,a=s+t,c=s-t;if(this.view!==null&&this.view.enabled){let l=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=l*this.view.offsetX,o=r+l*this.view.width,a-=u*this.view.offsetY,c=a-u*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,c,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},cc=class extends wr{constructor(){super(new Di(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Ni=class extends Pi{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ht.DEFAULT_UP),this.updateMatrix(),this.target=new ht,this.shadow=new cc}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}},Cr=class extends Pi{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}};var jn=class{static extractUrlBase(e){let t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}};var Jl=new WeakMap,Ir=class extends Dn{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,s){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let r=this,o=An.get(`image-bitmap:${e}`);if(o!==void 0){if(r.manager.itemStart(e),o.then){o.then(l=>{if(Jl.has(o)===!0)s&&s(Jl.get(o)),r.manager.itemError(e),r.manager.itemEnd(e);else return t&&t(l),r.manager.itemEnd(e),l});return}return setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0),o}let a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader,a.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let c=fetch(e,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(r.options,{colorSpaceConversion:"none"}))}).then(function(l){return An.add(`image-bitmap:${e}`,l),t&&t(l),r.manager.itemEnd(e),l}).catch(function(l){s&&s(l),Jl.set(c,l),An.remove(`image-bitmap:${e}`),r.manager.itemError(e),r.manager.itemEnd(e)});An.add(`image-bitmap:${e}`,c),r.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}};var Zo=class extends vt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}};var Ic="\\[\\]\\.:\\/",Ym=new RegExp("["+Ic+"]","g"),Pc="[^"+Ic+"]",qm="[^"+Ic.replace("\\.","")+"]",$m=/((?:WC+[\/:])*)/.source.replace("WC",Pc),jm=/(WCOD+)?/.source.replace("WCOD",qm),Km=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Pc),Zm=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Pc),Jm=new RegExp("^"+$m+jm+Km+Zm+"$"),Qm=["material","materials","bones","map"],uc=class{constructor(e,t,n){let s=n||ut.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,s)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,s=this._bindings[n];s!==void 0&&s.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let s=this._targetGroup.nCachedObjects_,r=n.length;s!==r;++s)n[s].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},ut=class i{constructor(e,t,n){this.path=t,this.parsedPath=n||i.parseTrackName(t),this.node=i.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new i.Composite(e,t,n):new i(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Ym,"")}static parseTrackName(e){let t=Jm.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},s=n.nodeName&&n.nodeName.lastIndexOf(".");if(s!==void 0&&s!==-1){let r=n.nodeName.substring(s+1);Qm.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,s),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(r){for(let o=0;o<r.length;o++){let a=r[o];if(a.name===t||a.uuid===t)return a;let c=n(a.children);if(c)return c}return null},s=n(e.children);if(s)return s}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)e[t++]=n[s]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let s=0,r=n.length;s!==r;++s)n[s]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node,t=this.parsedPath,n=t.objectName,s=t.propertyName,r=t.propertyIndex;if(e||(e=i.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let u=0;u<e.length;u++)if(e[u].name===l){l=u;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}let o=e[s];if(o===void 0){let l=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+s+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(r!==void 0){if(s==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=s;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};ut.Composite=uc;ut.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};ut.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};ut.prototype.GetterByBindingType=[ut.prototype._getValue_direct,ut.prototype._getValue_array,ut.prototype._getValue_arrayElement,ut.prototype._getValue_toArray];ut.prototype.SetterByBindingTypeAndVersioning=[[ut.prototype._setValue_direct,ut.prototype._setValue_direct_setNeedsUpdate,ut.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[ut.prototype._setValue_array,ut.prototype._setValue_array_setNeedsUpdate,ut.prototype._setValue_array_setMatrixWorldNeedsUpdate],[ut.prototype._setValue_arrayElement,ut.prototype._setValue_arrayElement_setNeedsUpdate,ut.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[ut.prototype._setValue_fromArray,ut.prototype._setValue_fromArray_setNeedsUpdate,ut.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var LS=new Float32Array(1);var Es=class{constructor(e=1,t=0,n=0){this.radius=e,this.phi=t,this.theta=n}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Xe(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(Xe(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}};var Pr=class extends Ci{constructor(e=10,t=10,n=4473924,s=8947848){n=new Pe(n),s=new Pe(s);let r=t/2,o=e/t,a=e/2,c=[],l=[];for(let d=0,p=0,g=-a;d<=t;d++,g+=o){c.push(-a,0,g,a,0,g),c.push(g,0,-a,g,0,a);let x=d===r?n:s;x.toArray(l,p),p+=3,x.toArray(l,p),p+=3,x.toArray(l,p),p+=3,x.toArray(l,p),p+=3}let u=new _t;u.setAttribute("position",new it(c,3)),u.setAttribute("color",new it(l,3));let h=new vn({vertexColors:!0,toneMapped:!1});super(u,h),this.type="GridHelper"}dispose(){this.geometry.dispose(),this.material.dispose()}};var Fh=new L,Co,Ql,Lr=class extends ht{constructor(e=new L(0,0,1),t=new L(0,0,0),n=1,s=16776960,r=n*.2,o=r*.2){super(),this.type="ArrowHelper",Co===void 0&&(Co=new _t,Co.setAttribute("position",new it([0,0,0,0,1,0],3)),Ql=new Vo(.5,1,5,1),Ql.translate(0,-.5,0)),this.position.copy(t),this.line=new Cn(Co,new vn({color:s,toneMapped:!1})),this.line.matrixAutoUpdate=!1,this.add(this.line),this.cone=new Qe(Ql,new Ft({color:s,toneMapped:!1})),this.cone.matrixAutoUpdate=!1,this.add(this.cone),this.setDirection(e),this.setLength(n,r,o)}setDirection(e){if(e.y>.99999)this.quaternion.set(0,0,0,1);else if(e.y<-.99999)this.quaternion.set(1,0,0,0);else{Fh.set(e.z,0,-e.x).normalize();let t=Math.acos(e.y);this.quaternion.setFromAxisAngle(Fh,t)}}setLength(e,t=e*.2,n=t*.2){this.line.scale.set(1,Math.max(1e-4,e-t),1),this.line.updateMatrix(),this.cone.scale.set(n,t,n),this.cone.position.y=e,this.cone.updateMatrix()}setColor(e){this.line.material.color.set(e),this.cone.material.color.set(e)}copy(e){return super.copy(e,!1),this.line.copy(e.line),this.cone.copy(e.cone),this}dispose(){this.line.geometry.dispose(),this.line.material.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}},Dr=class extends Ci{constructor(e=1){let t=[0,0,0,e,0,0,0,0,0,0,e,0,0,0,0,0,0,e],n=[1,0,0,1,.6,0,0,1,0,.6,1,0,0,0,1,0,.6,1],s=new _t;s.setAttribute("position",new it(t,3)),s.setAttribute("color",new it(n,3));let r=new vn({vertexColors:!0,toneMapped:!1});super(s,r),this.type="AxesHelper"}setColors(e,t,n){let s=new Pe,r=this.geometry.attributes.color.array;return s.set(e),s.toArray(r,0),s.toArray(r,3),s.set(t),s.toArray(r,6),s.toArray(r,9),s.set(n),s.toArray(r,12),s.toArray(r,15),this.geometry.attributes.color.needsUpdate=!0,this}dispose(){this.geometry.dispose(),this.material.dispose()}};var Nr=class extends wn{constructor(e,t=null){super(),this.object=e,this.domElement=t,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(e){if(e===void 0){console.warn("THREE.Controls: connect() now requires an element.");return}this.domElement!==null&&this.disconnect(),this.domElement=e}disconnect(){}dispose(){}update(){}};function Lc(i,e,t,n){let s=eg(n);switch(t){case Sc:return i*e;case fa:return i*e/s.components*s.byteLength;case pa:return i*e/s.components*s.byteLength;case bc:return i*e*2/s.components*s.byteLength;case ma:return i*e*2/s.components*s.byteLength;case Mc:return i*e*3/s.components*s.byteLength;case tn:return i*e*4/s.components*s.byteLength;case ga:return i*e*4/s.components*s.byteLength;case Ur:case Fr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case Br:case zr:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case xa:case va:return Math.max(i,16)*Math.max(e,8)/4;case _a:case ya:return Math.max(i,8)*Math.max(e,8)/2;case Sa:case Ma:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*8;case ba:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Ta:return Math.floor((i+3)/4)*Math.floor((e+3)/4)*16;case Ea:return Math.floor((i+4)/5)*Math.floor((e+3)/4)*16;case Aa:return Math.floor((i+4)/5)*Math.floor((e+4)/5)*16;case wa:return Math.floor((i+5)/6)*Math.floor((e+4)/5)*16;case Ra:return Math.floor((i+5)/6)*Math.floor((e+5)/6)*16;case Ca:return Math.floor((i+7)/8)*Math.floor((e+4)/5)*16;case Ia:return Math.floor((i+7)/8)*Math.floor((e+5)/6)*16;case Pa:return Math.floor((i+7)/8)*Math.floor((e+7)/8)*16;case La:return Math.floor((i+9)/10)*Math.floor((e+4)/5)*16;case Da:return Math.floor((i+9)/10)*Math.floor((e+5)/6)*16;case Na:return Math.floor((i+9)/10)*Math.floor((e+7)/8)*16;case Oa:return Math.floor((i+9)/10)*Math.floor((e+9)/10)*16;case Ua:return Math.floor((i+11)/12)*Math.floor((e+9)/10)*16;case Fa:return Math.floor((i+11)/12)*Math.floor((e+11)/12)*16;case Ba:case za:case ka:return Math.ceil(i/4)*Math.ceil(e/4)*16;case Ha:case Va:return Math.ceil(i/4)*Math.ceil(e/4)*8;case Ga:case Wa:return Math.ceil(i/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function eg(i){switch(i){case Mn:case _c:return{byteLength:1,components:1};case ws:case xc:case Rs:return{byteLength:2,components:1};case ha:case da:return{byteLength:2,components:4};case di:case ua:case un:return{byteLength:4,components:1};case yc:case vc:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${i}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"180"}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__="180");function tf(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function ng(i){let e=new WeakMap;function t(a,c){let l=a.array,u=a.usage,h=l.byteLength,d=i.createBuffer();i.bindBuffer(c,d),i.bufferData(c,l,u),a.onUploadCallback();let p;if(l instanceof Float32Array)p=i.FLOAT;else if(typeof Float16Array<"u"&&l instanceof Float16Array)p=i.HALF_FLOAT;else if(l instanceof Uint16Array)a.isFloat16BufferAttribute?p=i.HALF_FLOAT:p=i.UNSIGNED_SHORT;else if(l instanceof Int16Array)p=i.SHORT;else if(l instanceof Uint32Array)p=i.UNSIGNED_INT;else if(l instanceof Int32Array)p=i.INT;else if(l instanceof Int8Array)p=i.BYTE;else if(l instanceof Uint8Array)p=i.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)p=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:d,type:p,bytesPerElement:l.BYTES_PER_ELEMENT,version:a.version,size:h}}function n(a,c,l){let u=c.array,h=c.updateRanges;if(i.bindBuffer(l,a),h.length===0)i.bufferSubData(l,0,u);else{h.sort((p,g)=>p.start-g.start);let d=0;for(let p=1;p<h.length;p++){let g=h[d],x=h[p];x.start<=g.start+g.count+1?g.count=Math.max(g.count,x.start+x.count-g.start):(++d,h[d]=x)}h.length=d+1;for(let p=0,g=h.length;p<g;p++){let x=h[p];i.bufferSubData(l,x.start*u.BYTES_PER_ELEMENT,u,x.start,x.count)}c.clearUpdateRanges()}c.onUploadCallback()}function s(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);let c=e.get(a);c&&(i.deleteBuffer(c.buffer),e.delete(a))}function o(a,c){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let u=e.get(a);(!u||u.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let l=e.get(a);if(l===void 0)e.set(a,t(a,c));else if(l.version<a.version){if(l.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,a,c),l.version=a.version}}return{get:s,remove:r,update:o}}var ig=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,sg=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,rg=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,og=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,ag=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,lg=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,cg=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,ug=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,hg=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,dg=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,fg=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,pg=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,mg=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,gg=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,_g=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,xg=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,yg=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,vg=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Sg=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Mg=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,bg=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Tg=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Eg=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Ag=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,wg=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,Rg=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Cg=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Ig=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Pg=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Lg=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Dg="gl_FragColor = linearToOutputTexel( gl_FragColor );",Ng=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Og=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Ug=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Fg=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Bg=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,zg=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,kg=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Hg=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Vg=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Gg=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Wg=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Xg=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Yg=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,qg=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,$g=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,jg=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Kg=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Zg=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Jg=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Qg=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,e_=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,t_=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,n_=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,i_=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,s_=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,r_=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,o_=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,a_=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,l_=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,c_=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,u_=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,h_=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,d_=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,f_=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,p_=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,m_=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,g_=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,__=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,x_=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,y_=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,v_=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,S_=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,M_=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,b_=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,T_=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,E_=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,A_=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,w_=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,R_=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,C_=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,I_=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,P_=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,L_=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,D_=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,N_=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,O_=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,U_=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,F_=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,B_=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,z_=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,k_=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,H_=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,V_=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,G_=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,W_=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,X_=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Y_=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,q_=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,$_=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,j_=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,K_=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Z_=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,J_=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Q_=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,e0=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,t0=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,n0=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,i0=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,s0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,r0=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,o0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,a0=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,l0=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,c0=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,u0=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,h0=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,d0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,f0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,p0=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,m0=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,g0=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,_0=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,x0=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,y0=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,v0=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,S0=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,M0=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,b0=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,T0=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,E0=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,A0=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,w0=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,R0=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,C0=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,I0=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,P0=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,L0=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,D0=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,N0=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,O0=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,We={alphahash_fragment:ig,alphahash_pars_fragment:sg,alphamap_fragment:rg,alphamap_pars_fragment:og,alphatest_fragment:ag,alphatest_pars_fragment:lg,aomap_fragment:cg,aomap_pars_fragment:ug,batching_pars_vertex:hg,batching_vertex:dg,begin_vertex:fg,beginnormal_vertex:pg,bsdfs:mg,iridescence_fragment:gg,bumpmap_pars_fragment:_g,clipping_planes_fragment:xg,clipping_planes_pars_fragment:yg,clipping_planes_pars_vertex:vg,clipping_planes_vertex:Sg,color_fragment:Mg,color_pars_fragment:bg,color_pars_vertex:Tg,color_vertex:Eg,common:Ag,cube_uv_reflection_fragment:wg,defaultnormal_vertex:Rg,displacementmap_pars_vertex:Cg,displacementmap_vertex:Ig,emissivemap_fragment:Pg,emissivemap_pars_fragment:Lg,colorspace_fragment:Dg,colorspace_pars_fragment:Ng,envmap_fragment:Og,envmap_common_pars_fragment:Ug,envmap_pars_fragment:Fg,envmap_pars_vertex:Bg,envmap_physical_pars_fragment:jg,envmap_vertex:zg,fog_vertex:kg,fog_pars_vertex:Hg,fog_fragment:Vg,fog_pars_fragment:Gg,gradientmap_pars_fragment:Wg,lightmap_pars_fragment:Xg,lights_lambert_fragment:Yg,lights_lambert_pars_fragment:qg,lights_pars_begin:$g,lights_toon_fragment:Kg,lights_toon_pars_fragment:Zg,lights_phong_fragment:Jg,lights_phong_pars_fragment:Qg,lights_physical_fragment:e_,lights_physical_pars_fragment:t_,lights_fragment_begin:n_,lights_fragment_maps:i_,lights_fragment_end:s_,logdepthbuf_fragment:r_,logdepthbuf_pars_fragment:o_,logdepthbuf_pars_vertex:a_,logdepthbuf_vertex:l_,map_fragment:c_,map_pars_fragment:u_,map_particle_fragment:h_,map_particle_pars_fragment:d_,metalnessmap_fragment:f_,metalnessmap_pars_fragment:p_,morphinstance_vertex:m_,morphcolor_vertex:g_,morphnormal_vertex:__,morphtarget_pars_vertex:x_,morphtarget_vertex:y_,normal_fragment_begin:v_,normal_fragment_maps:S_,normal_pars_fragment:M_,normal_pars_vertex:b_,normal_vertex:T_,normalmap_pars_fragment:E_,clearcoat_normal_fragment_begin:A_,clearcoat_normal_fragment_maps:w_,clearcoat_pars_fragment:R_,iridescence_pars_fragment:C_,opaque_fragment:I_,packing:P_,premultiplied_alpha_fragment:L_,project_vertex:D_,dithering_fragment:N_,dithering_pars_fragment:O_,roughnessmap_fragment:U_,roughnessmap_pars_fragment:F_,shadowmap_pars_fragment:B_,shadowmap_pars_vertex:z_,shadowmap_vertex:k_,shadowmask_pars_fragment:H_,skinbase_vertex:V_,skinning_pars_vertex:G_,skinning_vertex:W_,skinnormal_vertex:X_,specularmap_fragment:Y_,specularmap_pars_fragment:q_,tonemapping_fragment:$_,tonemapping_pars_fragment:j_,transmission_fragment:K_,transmission_pars_fragment:Z_,uv_pars_fragment:J_,uv_pars_vertex:Q_,uv_vertex:e0,worldpos_vertex:t0,background_vert:n0,background_frag:i0,backgroundCube_vert:s0,backgroundCube_frag:r0,cube_vert:o0,cube_frag:a0,depth_vert:l0,depth_frag:c0,distanceRGBA_vert:u0,distanceRGBA_frag:h0,equirect_vert:d0,equirect_frag:f0,linedashed_vert:p0,linedashed_frag:m0,meshbasic_vert:g0,meshbasic_frag:_0,meshlambert_vert:x0,meshlambert_frag:y0,meshmatcap_vert:v0,meshmatcap_frag:S0,meshnormal_vert:M0,meshnormal_frag:b0,meshphong_vert:T0,meshphong_frag:E0,meshphysical_vert:A0,meshphysical_frag:w0,meshtoon_vert:R0,meshtoon_frag:C0,points_vert:I0,points_frag:P0,shadow_vert:L0,shadow_frag:D0,sprite_vert:N0,sprite_frag:O0},he={common:{diffuse:{value:new Pe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ge}},envmap:{envMap:{value:null},envMapRotation:{value:new Ge},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ge}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ge}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ge},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ge},normalScale:{value:new we(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ge},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ge}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ge}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ge}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Pe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Pe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0},uvTransform:{value:new Ge}},sprite:{diffuse:{value:new Pe(16777215)},opacity:{value:1},center:{value:new we(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ge},alphaMap:{value:null},alphaMapTransform:{value:new Ge},alphaTest:{value:0}}},On={basic:{uniforms:zt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.fog]),vertexShader:We.meshbasic_vert,fragmentShader:We.meshbasic_frag},lambert:{uniforms:zt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new Pe(0)}}]),vertexShader:We.meshlambert_vert,fragmentShader:We.meshlambert_frag},phong:{uniforms:zt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new Pe(0)},specular:{value:new Pe(1118481)},shininess:{value:30}}]),vertexShader:We.meshphong_vert,fragmentShader:We.meshphong_frag},standard:{uniforms:zt([he.common,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.roughnessmap,he.metalnessmap,he.fog,he.lights,{emissive:{value:new Pe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:We.meshphysical_vert,fragmentShader:We.meshphysical_frag},toon:{uniforms:zt([he.common,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.gradientmap,he.fog,he.lights,{emissive:{value:new Pe(0)}}]),vertexShader:We.meshtoon_vert,fragmentShader:We.meshtoon_frag},matcap:{uniforms:zt([he.common,he.bumpmap,he.normalmap,he.displacementmap,he.fog,{matcap:{value:null}}]),vertexShader:We.meshmatcap_vert,fragmentShader:We.meshmatcap_frag},points:{uniforms:zt([he.points,he.fog]),vertexShader:We.points_vert,fragmentShader:We.points_frag},dashed:{uniforms:zt([he.common,he.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:We.linedashed_vert,fragmentShader:We.linedashed_frag},depth:{uniforms:zt([he.common,he.displacementmap]),vertexShader:We.depth_vert,fragmentShader:We.depth_frag},normal:{uniforms:zt([he.common,he.bumpmap,he.normalmap,he.displacementmap,{opacity:{value:1}}]),vertexShader:We.meshnormal_vert,fragmentShader:We.meshnormal_frag},sprite:{uniforms:zt([he.sprite,he.fog]),vertexShader:We.sprite_vert,fragmentShader:We.sprite_frag},background:{uniforms:{uvTransform:{value:new Ge},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:We.background_vert,fragmentShader:We.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ge}},vertexShader:We.backgroundCube_vert,fragmentShader:We.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:We.cube_vert,fragmentShader:We.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:We.equirect_vert,fragmentShader:We.equirect_frag},distanceRGBA:{uniforms:zt([he.common,he.displacementmap,{referencePosition:{value:new L},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:We.distanceRGBA_vert,fragmentShader:We.distanceRGBA_frag},shadow:{uniforms:zt([he.lights,he.fog,{color:{value:new Pe(0)},opacity:{value:1}}]),vertexShader:We.shadow_vert,fragmentShader:We.shadow_frag}};On.physical={uniforms:zt([On.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ge},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ge},clearcoatNormalScale:{value:new we(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ge},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ge},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ge},sheen:{value:0},sheenColor:{value:new Pe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ge},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ge},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ge},transmissionSamplerSize:{value:new we},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ge},attenuationDistance:{value:0},attenuationColor:{value:new Pe(0)},specularColor:{value:new Pe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ge},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ge},anisotropyVector:{value:new we},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ge}}]),vertexShader:We.meshphysical_vert,fragmentShader:We.meshphysical_frag};var qa={r:0,b:0,g:0},zi=new cn,U0=new Ve;function F0(i,e,t,n,s,r,o){let a=new Pe(0),c=r===!0?0:1,l,u,h=null,d=0,p=null;function g(b){let M=b.isScene===!0?b.background:null;return M&&M.isTexture&&(M=(b.backgroundBlurriness>0?t:e).get(M)),M}function x(b){let M=!1,A=g(b);A===null?f(a,c):A&&A.isColor&&(f(A,1),M=!0);let E=i.xr.getEnvironmentBlendMode();E==="additive"?n.buffers.color.setClear(0,0,0,1,o):E==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||M)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil))}function m(b,M){let A=g(M);A&&(A.isCubeTexture||A.mapping===Or)?(u===void 0&&(u=new Qe(new ai(1,1,1),new yn({name:"BackgroundCubeMaterial",uniforms:Bi(On.backgroundCube.uniforms),vertexShader:On.backgroundCube.vertexShader,fragmentShader:On.backgroundCube.fragmentShader,side:Et,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(E,C,D){this.matrixWorld.copyPosition(D.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(u)),zi.copy(M.backgroundRotation),zi.x*=-1,zi.y*=-1,zi.z*=-1,A.isCubeTexture&&A.isRenderTargetTexture===!1&&(zi.y*=-1,zi.z*=-1),u.material.uniforms.envMap.value=A,u.material.uniforms.flipEnvMap.value=A.isCubeTexture&&A.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=M.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(U0.makeRotationFromEuler(zi)),u.material.toneMapped=Ke.getTransfer(A.colorSpace)!==at,(h!==A||d!==A.version||p!==i.toneMapping)&&(u.material.needsUpdate=!0,h=A,d=A.version,p=i.toneMapping),u.layers.enableAll(),b.unshift(u,u.geometry,u.material,0,0,null)):A&&A.isTexture&&(l===void 0&&(l=new Qe(new Mr(2,2),new yn({name:"BackgroundMaterial",uniforms:Bi(On.background.uniforms),vertexShader:On.background.vertexShader,fragmentShader:On.background.fragmentShader,side:xn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(l)),l.material.uniforms.t2D.value=A,l.material.uniforms.backgroundIntensity.value=M.backgroundIntensity,l.material.toneMapped=Ke.getTransfer(A.colorSpace)!==at,A.matrixAutoUpdate===!0&&A.updateMatrix(),l.material.uniforms.uvTransform.value.copy(A.matrix),(h!==A||d!==A.version||p!==i.toneMapping)&&(l.material.needsUpdate=!0,h=A,d=A.version,p=i.toneMapping),l.layers.enableAll(),b.unshift(l,l.geometry,l.material,0,0,null))}function f(b,M){b.getRGB(qa,Cc(i)),n.buffers.color.setClear(qa.r,qa.g,qa.b,M,o)}function T(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(b,M=1){a.set(b),c=M,f(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(b){c=b,f(a,c)},render:x,addToRenderList:m,dispose:T}}function B0(i,e){let t=i.getParameter(i.MAX_VERTEX_ATTRIBS),n={},s=d(null),r=s,o=!1;function a(y,P,F,k,H){let q=!1,W=h(k,F,P);r!==W&&(r=W,l(r.object)),q=p(y,k,F,H),q&&g(y,k,F,H),H!==null&&e.update(H,i.ELEMENT_ARRAY_BUFFER),(q||o)&&(o=!1,M(y,P,F,k),H!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,e.get(H).buffer))}function c(){return i.createVertexArray()}function l(y){return i.bindVertexArray(y)}function u(y){return i.deleteVertexArray(y)}function h(y,P,F){let k=F.wireframe===!0,H=n[y.id];H===void 0&&(H={},n[y.id]=H);let q=H[P.id];q===void 0&&(q={},H[P.id]=q);let W=q[k];return W===void 0&&(W=d(c()),q[k]=W),W}function d(y){let P=[],F=[],k=[];for(let H=0;H<t;H++)P[H]=0,F[H]=0,k[H]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:F,attributeDivisors:k,object:y,attributes:{},index:null}}function p(y,P,F,k){let H=r.attributes,q=P.attributes,W=0,te=F.getAttributes();for(let V in te)if(te[V].location>=0){let ce=H[V],Te=q[V];if(Te===void 0&&(V==="instanceMatrix"&&y.instanceMatrix&&(Te=y.instanceMatrix),V==="instanceColor"&&y.instanceColor&&(Te=y.instanceColor)),ce===void 0||ce.attribute!==Te||Te&&ce.data!==Te.data)return!0;W++}return r.attributesNum!==W||r.index!==k}function g(y,P,F,k){let H={},q=P.attributes,W=0,te=F.getAttributes();for(let V in te)if(te[V].location>=0){let ce=q[V];ce===void 0&&(V==="instanceMatrix"&&y.instanceMatrix&&(ce=y.instanceMatrix),V==="instanceColor"&&y.instanceColor&&(ce=y.instanceColor));let Te={};Te.attribute=ce,ce&&ce.data&&(Te.data=ce.data),H[V]=Te,W++}r.attributes=H,r.attributesNum=W,r.index=k}function x(){let y=r.newAttributes;for(let P=0,F=y.length;P<F;P++)y[P]=0}function m(y){f(y,0)}function f(y,P){let F=r.newAttributes,k=r.enabledAttributes,H=r.attributeDivisors;F[y]=1,k[y]===0&&(i.enableVertexAttribArray(y),k[y]=1),H[y]!==P&&(i.vertexAttribDivisor(y,P),H[y]=P)}function T(){let y=r.newAttributes,P=r.enabledAttributes;for(let F=0,k=P.length;F<k;F++)P[F]!==y[F]&&(i.disableVertexAttribArray(F),P[F]=0)}function b(y,P,F,k,H,q,W){W===!0?i.vertexAttribIPointer(y,P,F,H,q):i.vertexAttribPointer(y,P,F,k,H,q)}function M(y,P,F,k){x();let H=k.attributes,q=F.getAttributes(),W=P.defaultAttributeValues;for(let te in q){let V=q[te];if(V.location>=0){let oe=H[te];if(oe===void 0&&(te==="instanceMatrix"&&y.instanceMatrix&&(oe=y.instanceMatrix),te==="instanceColor"&&y.instanceColor&&(oe=y.instanceColor)),oe!==void 0){let ce=oe.normalized,Te=oe.itemSize,re=e.get(oe);if(re===void 0)continue;let ae=re.buffer,Oe=re.type,Re=re.bytesPerElement,G=Oe===i.INT||Oe===i.UNSIGNED_INT||oe.gpuType===ua;if(oe.isInterleavedBufferAttribute){let K=oe.data,de=K.stride,Ce=oe.offset;if(K.isInstancedInterleavedBuffer){for(let _e=0;_e<V.locationSize;_e++)f(V.location+_e,K.meshPerAttribute);y.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=K.meshPerAttribute*K.count)}else for(let _e=0;_e<V.locationSize;_e++)m(V.location+_e);i.bindBuffer(i.ARRAY_BUFFER,ae);for(let _e=0;_e<V.locationSize;_e++)b(V.location+_e,Te/V.locationSize,Oe,ce,de*Re,(Ce+Te/V.locationSize*_e)*Re,G)}else{if(oe.isInstancedBufferAttribute){for(let K=0;K<V.locationSize;K++)f(V.location+K,oe.meshPerAttribute);y.isInstancedMesh!==!0&&k._maxInstanceCount===void 0&&(k._maxInstanceCount=oe.meshPerAttribute*oe.count)}else for(let K=0;K<V.locationSize;K++)m(V.location+K);i.bindBuffer(i.ARRAY_BUFFER,ae);for(let K=0;K<V.locationSize;K++)b(V.location+K,Te/V.locationSize,Oe,ce,Te*Re,Te/V.locationSize*K*Re,G)}}else if(W!==void 0){let ce=W[te];if(ce!==void 0)switch(ce.length){case 2:i.vertexAttrib2fv(V.location,ce);break;case 3:i.vertexAttrib3fv(V.location,ce);break;case 4:i.vertexAttrib4fv(V.location,ce);break;default:i.vertexAttrib1fv(V.location,ce)}}}}T()}function A(){D();for(let y in n){let P=n[y];for(let F in P){let k=P[F];for(let H in k)u(k[H].object),delete k[H];delete P[F]}delete n[y]}}function E(y){if(n[y.id]===void 0)return;let P=n[y.id];for(let F in P){let k=P[F];for(let H in k)u(k[H].object),delete k[H];delete P[F]}delete n[y.id]}function C(y){for(let P in n){let F=n[P];if(F[y.id]===void 0)continue;let k=F[y.id];for(let H in k)u(k[H].object),delete k[H];delete F[y.id]}}function D(){S(),o=!0,r!==s&&(r=s,l(r.object))}function S(){s.geometry=null,s.program=null,s.wireframe=!1}return{setup:a,reset:D,resetDefaultState:S,dispose:A,releaseStatesOfGeometry:E,releaseStatesOfProgram:C,initAttributes:x,enableAttribute:m,disableUnusedAttributes:T}}function z0(i,e,t){let n;function s(l){n=l}function r(l,u){i.drawArrays(n,l,u),t.update(u,n,1)}function o(l,u,h){h!==0&&(i.drawArraysInstanced(n,l,u,h),t.update(u,n,h))}function a(l,u,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,u,0,h);let p=0;for(let g=0;g<h;g++)p+=u[g];t.update(p,n,1)}function c(l,u,h,d){if(h===0)return;let p=e.get("WEBGL_multi_draw");if(p===null)for(let g=0;g<l.length;g++)o(l[g],u[g],d[g]);else{p.multiDrawArraysInstancedWEBGL(n,l,0,u,0,d,0,h);let g=0;for(let x=0;x<h;x++)g+=u[x]*d[x];t.update(g,n,1)}}this.setMode=s,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=c}function k0(i,e,t,n){let s;function r(){if(s!==void 0)return s;if(e.has("EXT_texture_filter_anisotropic")===!0){let C=e.get("EXT_texture_filter_anisotropic");s=i.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else s=0;return s}function o(C){return!(C!==tn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){let D=C===Rs&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==Mn&&n.convert(C)!==i.getParameter(i.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==un&&!D)}function c(C){if(C==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=t.precision!==void 0?t.precision:"highp",u=c(l);u!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",u,"instead."),l=u);let h=t.logarithmicDepthBuffer===!0,d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),p=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),g=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=i.getParameter(i.MAX_TEXTURE_SIZE),m=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),f=i.getParameter(i.MAX_VERTEX_ATTRIBS),T=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),b=i.getParameter(i.MAX_VARYING_VECTORS),M=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),A=g>0,E=i.getParameter(i.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:a,precision:l,logarithmicDepthBuffer:h,reversedDepthBuffer:d,maxTextures:p,maxVertexTextures:g,maxTextureSize:x,maxCubemapSize:m,maxAttributes:f,maxVertexUniforms:T,maxVaryings:b,maxFragmentUniforms:M,vertexTextures:A,maxSamples:E}}function H0(i){let e=this,t=null,n=0,s=!1,r=!1,o=new ln,a=new Ge,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(h,d){let p=h.length!==0||d||n!==0||s;return s=d,n=h.length,p},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(h,d){t=u(h,d,0)},this.setState=function(h,d,p){let g=h.clippingPlanes,x=h.clipIntersection,m=h.clipShadows,f=i.get(h);if(!s||g===null||g.length===0||r&&!m)r?u(null):l();else{let T=r?0:n,b=T*4,M=f.clippingState||null;c.value=M,M=u(g,d,b,p);for(let A=0;A!==b;++A)M[A]=t[A];f.clippingState=M,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=T}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function u(h,d,p,g){let x=h!==null?h.length:0,m=null;if(x!==0){if(m=c.value,g!==!0||m===null){let f=p+x*4,T=d.matrixWorldInverse;a.getNormalMatrix(T),(m===null||m.length<f)&&(m=new Float32Array(f));for(let b=0,M=p;b!==x;++b,M+=4)o.copy(h[b]).applyMatrix4(T,a),o.normal.toArray(m,M),m[M+3]=o.constant}c.value=m,c.needsUpdate=!0}return e.numPlanes=x,e.numIntersection=0,m}}function V0(i){let e=new WeakMap;function t(o,a){return a===aa?o.mapping=Oi:a===la&&(o.mapping=Ui),o}function n(o){if(o&&o.isTexture){let a=o.mapping;if(a===aa||a===la)if(e.has(o)){let c=e.get(o).texture;return t(c,o.mapping)}else{let c=o.image;if(c&&c.height>0){let l=new Bo(c.height);return l.fromEquirectangularTexture(i,o),e.set(o,l),o.addEventListener("dispose",s),t(l.texture,o.mapping)}else return null}}return o}function s(o){let a=o.target;a.removeEventListener("dispose",s);let c=e.get(a);c!==void 0&&(e.delete(a),c.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}var Ds=4,Ld=[.125,.215,.35,.446,.526,.582],Vi=20,Dc=new Di,Dd=new Pe,Nc=null,Oc=0,Uc=0,Fc=!1,Hi=(1+Math.sqrt(5))/2,Ls=1/Hi,Nd=[new L(-Hi,Ls,0),new L(Hi,Ls,0),new L(-Ls,0,Hi),new L(Ls,0,Hi),new L(0,Hi,-Ls),new L(0,Hi,Ls),new L(-1,1,-1),new L(1,1,-1),new L(-1,1,1),new L(1,1,1)],G0=new L,Os=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100,r={}){let{size:o=256,position:a=G0}=r;Nc=this._renderer.getRenderTarget(),Oc=this._renderer.getActiveCubeFace(),Uc=this._renderer.getActiveMipmapLevel(),Fc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let c=this._allocateTargets();return c.depthBuffer=!0,this._sceneToCubeUV(e,n,s,c,a),t>0&&this._blur(c,0,0,t),this._applyPMREM(c),this._cleanup(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Fd(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Ud(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Nc,Oc,Uc),this._renderer.xr.enabled=Fc,e.scissorTest=!1,$a(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Oi||e.mapping===Ui?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Nc=this._renderer.getRenderTarget(),Oc=this._renderer.getActiveCubeFace(),Uc=this._renderer.getActiveMipmapLevel(),Fc=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Vt,minFilter:Vt,generateMipmaps:!1,type:Rs,format:tn,colorSpace:Lt,depthBuffer:!1},s=Od(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Od(e,t,n);let{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=W0(r)),this._blurMaterial=X0(r,e,t)}return s}_compileMaterial(e){let t=new Qe(this._lodPlanes[0],e);this._renderer.compile(t,Dc)}_sceneToCubeUV(e,t,n,s,r){let c=new vt(90,1,t,n),l=[1,-1,1,1,1,1],u=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,p=h.toneMapping;h.getClearColor(Dd),h.toneMapping=Zn,h.autoClear=!1,h.state.buffers.depth.getReversed()&&(h.setRenderTarget(s),h.clearDepth(),h.setRenderTarget(null));let x=new Ft({name:"PMREM.Background",side:Et,depthWrite:!1,depthTest:!1}),m=new Qe(new ai,x),f=!1,T=e.background;T?T.isColor&&(x.color.copy(T),e.background=null,f=!0):(x.color.copy(Dd),f=!0);for(let b=0;b<6;b++){let M=b%3;M===0?(c.up.set(0,l[b],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x+u[b],r.y,r.z)):M===1?(c.up.set(0,0,l[b]),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y+u[b],r.z)):(c.up.set(0,l[b],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y,r.z+u[b]));let A=this._cubeSize;$a(s,M*A,b>2?A:0,A,A),h.setRenderTarget(s),f&&h.render(m,c),h.render(e,c)}m.geometry.dispose(),m.material.dispose(),h.toneMapping=p,h.autoClear=d,e.background=T}_textureToCubeUV(e,t){let n=this._renderer,s=e.mapping===Oi||e.mapping===Ui;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=Fd()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Ud());let r=s?this._cubemapMaterial:this._equirectMaterial,o=new Qe(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;let c=this._cubeSize;$a(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(o,Dc)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let s=this._lodPlanes.length;for(let r=1;r<s;r++){let o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=Nd[(s-r-1)%Nd.length];this._blur(e,r-1,r,o,a)}t.autoClear=n}_blur(e,t,n,s,r){let o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){let c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");let u=3,h=new Qe(this._lodPlanes[s],l),d=l.uniforms,p=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*Vi-1),x=r/g,m=isFinite(r)?1+Math.floor(u*x):Vi;m>Vi&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Vi}`);let f=[],T=0;for(let C=0;C<Vi;++C){let D=C/x,S=Math.exp(-D*D/2);f.push(S),C===0?T+=S:C<m&&(T+=2*S)}for(let C=0;C<f.length;C++)f[C]=f[C]/T;d.envMap.value=e.texture,d.samples.value=m,d.weights.value=f,d.latitudinal.value=o==="latitudinal",a&&(d.poleAxis.value=a);let{_lodMax:b}=this;d.dTheta.value=g,d.mipInt.value=b-n;let M=this._sizeLods[s],A=3*M*(s>b-Ds?s-b+Ds:0),E=4*(this._cubeSize-M);$a(t,A,E,3*M,2*M),c.setRenderTarget(t),c.render(h,Dc)}};function W0(i){let e=[],t=[],n=[],s=i,r=i-Ds+1+Ld.length;for(let o=0;o<r;o++){let a=Math.pow(2,s);t.push(a);let c=1/a;o>i-Ds?c=Ld[o-i+Ds-1]:o===0&&(c=0),n.push(c);let l=1/(a-2),u=-l,h=1+l,d=[u,u,h,u,h,h,u,u,h,h,u,h],p=6,g=6,x=3,m=2,f=1,T=new Float32Array(x*g*p),b=new Float32Array(m*g*p),M=new Float32Array(f*g*p);for(let E=0;E<p;E++){let C=E%3*2/3-1,D=E>2?0:-1,S=[C,D,0,C+2/3,D,0,C+2/3,D+1,0,C,D,0,C+2/3,D+1,0,C,D+1,0];T.set(S,x*g*E),b.set(d,m*g*E);let y=[E,E,E,E,E,E];M.set(y,f*g*E)}let A=new _t;A.setAttribute("position",new Mt(T,x)),A.setAttribute("uv",new Mt(b,m)),A.setAttribute("faceIndex",new Mt(M,f)),e.push(A),s>Ds&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Od(i,e,t){let n=new Rn(i,e,t);return n.texture.mapping=Or,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function $a(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function X0(i,e,t){let n=new Float32Array(Vi),s=new L(0,1,0);return new yn({name:"SphericalGaussianBlur",defines:{n:Vi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:qc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function Ud(){return new yn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:qc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function Fd(){return new yn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:qc(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Kn,depthTest:!1,depthWrite:!1})}function qc(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Y0(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){let c=a.mapping,l=c===aa||c===la,u=c===Oi||c===Ui;if(l||u){let h=e.get(a),d=h!==void 0?h.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==d)return t===null&&(t=new Os(i)),h=l?t.fromEquirectangular(a,h):t.fromCubemap(a,h),h.texture.pmremVersion=a.pmremVersion,e.set(a,h),h.texture;if(h!==void 0)return h.texture;{let p=a.image;return l&&p&&p.height>0||u&&p&&s(p)?(t===null&&(t=new Os(i)),h=l?t.fromEquirectangular(a):t.fromCubemap(a),h.texture.pmremVersion=a.pmremVersion,e.set(a,h),a.addEventListener("dispose",r),h.texture):null}}}return a}function s(a){let c=0,l=6;for(let u=0;u<l;u++)a[u]!==void 0&&c++;return c===l}function r(a){let c=a.target;c.removeEventListener("dispose",r);let l=e.get(c);l!==void 0&&(e.delete(c),l.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function q0(i){let e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){let s=t(n);return s===null&&_s("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function $0(i,e,t,n){let s={},r=new WeakMap;function o(h){let d=h.target;d.index!==null&&e.remove(d.index);for(let g in d.attributes)e.remove(d.attributes[g]);d.removeEventListener("dispose",o),delete s[d.id];let p=r.get(d);p&&(e.remove(p),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function a(h,d){return s[d.id]===!0||(d.addEventListener("dispose",o),s[d.id]=!0,t.memory.geometries++),d}function c(h){let d=h.attributes;for(let p in d)e.update(d[p],i.ARRAY_BUFFER)}function l(h){let d=[],p=h.index,g=h.attributes.position,x=0;if(p!==null){let T=p.array;x=p.version;for(let b=0,M=T.length;b<M;b+=3){let A=T[b+0],E=T[b+1],C=T[b+2];d.push(A,E,E,C,C,A)}}else if(g!==void 0){let T=g.array;x=g.version;for(let b=0,M=T.length/3-1;b<M;b+=3){let A=b+0,E=b+1,C=b+2;d.push(A,E,E,C,C,A)}}else return;let m=new(Rc(d)?cr:lr)(d,1);m.version=x;let f=r.get(h);f&&e.remove(f),r.set(h,m)}function u(h){let d=r.get(h);if(d){let p=h.index;p!==null&&d.version<p.version&&l(h)}else l(h);return r.get(h)}return{get:a,update:c,getWireframeAttribute:u}}function j0(i,e,t){let n;function s(d){n=d}let r,o;function a(d){r=d.type,o=d.bytesPerElement}function c(d,p){i.drawElements(n,p,r,d*o),t.update(p,n,1)}function l(d,p,g){g!==0&&(i.drawElementsInstanced(n,p,r,d*o,g),t.update(p,n,g))}function u(d,p,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,d,0,g);let m=0;for(let f=0;f<g;f++)m+=p[f];t.update(m,n,1)}function h(d,p,g,x){if(g===0)return;let m=e.get("WEBGL_multi_draw");if(m===null)for(let f=0;f<d.length;f++)l(d[f]/o,p[f],x[f]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,d,0,x,0,g);let f=0;for(let T=0;T<g;T++)f+=p[T]*x[T];t.update(f,n,1)}}this.setMode=s,this.setIndex=a,this.render=c,this.renderInstances=l,this.renderMultiDraw=u,this.renderMultiDrawInstances=h}function K0(i){let e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Z0(i,e,t){let n=new WeakMap,s=new Je;function r(o,a,c){let l=o.morphTargetInfluences,u=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,h=u!==void 0?u.length:0,d=n.get(a);if(d===void 0||d.count!==h){let S=function(){C.dispose(),n.delete(a),a.removeEventListener("dispose",S)};d!==void 0&&d.texture.dispose();let p=a.morphAttributes.position!==void 0,g=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],f=a.morphAttributes.normal||[],T=a.morphAttributes.color||[],b=0;p===!0&&(b=1),g===!0&&(b=2),x===!0&&(b=3);let M=a.attributes.position.count*b,A=1;M>e.maxTextureSize&&(A=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);let E=new Float32Array(M*A*4*h),C=new or(E,M,A,h);C.type=un,C.needsUpdate=!0;let D=b*4;for(let y=0;y<h;y++){let P=m[y],F=f[y],k=T[y],H=M*A*4*y;for(let q=0;q<P.count;q++){let W=q*D;p===!0&&(s.fromBufferAttribute(P,q),E[H+W+0]=s.x,E[H+W+1]=s.y,E[H+W+2]=s.z,E[H+W+3]=0),g===!0&&(s.fromBufferAttribute(F,q),E[H+W+4]=s.x,E[H+W+5]=s.y,E[H+W+6]=s.z,E[H+W+7]=0),x===!0&&(s.fromBufferAttribute(k,q),E[H+W+8]=s.x,E[H+W+9]=s.y,E[H+W+10]=s.z,E[H+W+11]=k.itemSize===4?s.w:1)}}d={count:h,texture:C,size:new we(M,A)},n.set(a,d),a.addEventListener("dispose",S)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)c.getUniforms().setValue(i,"morphTexture",o.morphTexture,t);else{let p=0;for(let x=0;x<l.length;x++)p+=l[x];let g=a.morphTargetsRelative?1:1-p;c.getUniforms().setValue(i,"morphTargetBaseInfluence",g),c.getUniforms().setValue(i,"morphTargetInfluences",l)}c.getUniforms().setValue(i,"morphTargetsTexture",d.texture,t),c.getUniforms().setValue(i,"morphTargetsTextureSize",d.size)}return{update:r}}function J0(i,e,t,n){let s=new WeakMap;function r(c){let l=n.render.frame,u=c.geometry,h=e.get(c,u);if(s.get(h)!==l&&(e.update(h),s.set(h,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),s.get(c)!==l&&(t.update(c.instanceMatrix,i.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,i.ARRAY_BUFFER),s.set(c,l))),c.isSkinnedMesh){let d=c.skeleton;s.get(d)!==l&&(d.update(),s.set(d,l))}return h}function o(){s=new WeakMap}function a(c){let l=c.target;l.removeEventListener("dispose",a),t.remove(l.instanceMatrix),l.instanceColor!==null&&t.remove(l.instanceColor)}return{update:r,dispose:o}}var nf=new Tt,Bd=new yr(1,1),sf=new or,rf=new Uo,of=new hr,zd=[],kd=[],Hd=new Float32Array(16),Vd=new Float32Array(9),Gd=new Float32Array(4);function Us(i,e,t){let n=i[0];if(n<=0||n>0)return i;let s=e*t,r=zd[s];if(r===void 0&&(r=new Float32Array(s),zd[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function At(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function wt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Za(i,e){let t=kd[e];t===void 0&&(t=new Int32Array(e),kd[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function Q0(i,e){let t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function ex(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2fv(this.addr,e),wt(t,e)}}function tx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(At(t,e))return;i.uniform3fv(this.addr,e),wt(t,e)}}function nx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4fv(this.addr,e),wt(t,e)}}function ix(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),wt(t,e)}else{if(At(t,n))return;Gd.set(n),i.uniformMatrix2fv(this.addr,!1,Gd),wt(t,n)}}function sx(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),wt(t,e)}else{if(At(t,n))return;Vd.set(n),i.uniformMatrix3fv(this.addr,!1,Vd),wt(t,n)}}function rx(i,e){let t=this.cache,n=e.elements;if(n===void 0){if(At(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),wt(t,e)}else{if(At(t,n))return;Hd.set(n),i.uniformMatrix4fv(this.addr,!1,Hd),wt(t,n)}}function ox(i,e){let t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function ax(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2iv(this.addr,e),wt(t,e)}}function lx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(At(t,e))return;i.uniform3iv(this.addr,e),wt(t,e)}}function cx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4iv(this.addr,e),wt(t,e)}}function ux(i,e){let t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function hx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(At(t,e))return;i.uniform2uiv(this.addr,e),wt(t,e)}}function dx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(At(t,e))return;i.uniform3uiv(this.addr,e),wt(t,e)}}function fx(i,e){let t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(At(t,e))return;i.uniform4uiv(this.addr,e),wt(t,e)}}function px(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);let r;this.type===i.SAMPLER_2D_SHADOW?(Bd.compareFunction=Ec,r=Bd):r=nf,t.setTexture2D(e||r,s)}function mx(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||rf,s)}function gx(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||of,s)}function _x(i,e,t){let n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||sf,s)}function xx(i){switch(i){case 5126:return Q0;case 35664:return ex;case 35665:return tx;case 35666:return nx;case 35674:return ix;case 35675:return sx;case 35676:return rx;case 5124:case 35670:return ox;case 35667:case 35671:return ax;case 35668:case 35672:return lx;case 35669:case 35673:return cx;case 5125:return ux;case 36294:return hx;case 36295:return dx;case 36296:return fx;case 35678:case 36198:case 36298:case 36306:case 35682:return px;case 35679:case 36299:case 36307:return mx;case 35680:case 36300:case 36308:case 36293:return gx;case 36289:case 36303:case 36311:case 36292:return _x}}function yx(i,e){i.uniform1fv(this.addr,e)}function vx(i,e){let t=Us(e,this.size,2);i.uniform2fv(this.addr,t)}function Sx(i,e){let t=Us(e,this.size,3);i.uniform3fv(this.addr,t)}function Mx(i,e){let t=Us(e,this.size,4);i.uniform4fv(this.addr,t)}function bx(i,e){let t=Us(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Tx(i,e){let t=Us(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function Ex(i,e){let t=Us(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Ax(i,e){i.uniform1iv(this.addr,e)}function wx(i,e){i.uniform2iv(this.addr,e)}function Rx(i,e){i.uniform3iv(this.addr,e)}function Cx(i,e){i.uniform4iv(this.addr,e)}function Ix(i,e){i.uniform1uiv(this.addr,e)}function Px(i,e){i.uniform2uiv(this.addr,e)}function Lx(i,e){i.uniform3uiv(this.addr,e)}function Dx(i,e){i.uniform4uiv(this.addr,e)}function Nx(i,e,t){let n=this.cache,s=e.length,r=Za(t,s);At(n,r)||(i.uniform1iv(this.addr,r),wt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||nf,r[o])}function Ox(i,e,t){let n=this.cache,s=e.length,r=Za(t,s);At(n,r)||(i.uniform1iv(this.addr,r),wt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||rf,r[o])}function Ux(i,e,t){let n=this.cache,s=e.length,r=Za(t,s);At(n,r)||(i.uniform1iv(this.addr,r),wt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||of,r[o])}function Fx(i,e,t){let n=this.cache,s=e.length,r=Za(t,s);At(n,r)||(i.uniform1iv(this.addr,r),wt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||sf,r[o])}function Bx(i){switch(i){case 5126:return yx;case 35664:return vx;case 35665:return Sx;case 35666:return Mx;case 35674:return bx;case 35675:return Tx;case 35676:return Ex;case 5124:case 35670:return Ax;case 35667:case 35671:return wx;case 35668:case 35672:return Rx;case 35669:case 35673:return Cx;case 5125:return Ix;case 36294:return Px;case 36295:return Lx;case 36296:return Dx;case 35678:case 36198:case 36298:case 36306:case 35682:return Nx;case 35679:case 36299:case 36307:return Ox;case 35680:case 36300:case 36308:case 36293:return Ux;case 36289:case 36303:case 36311:case 36292:return Fx}}var zc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=xx(t.type)}},kc=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Bx(t.type)}},Hc=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let s=this.seq;for(let r=0,o=s.length;r!==o;++r){let a=s[r];a.setValue(e,t[a.id],n)}}},Bc=/(\w+)(\])?(\[|\.)?/g;function Wd(i,e){i.seq.push(e),i.map[e.id]=e}function zx(i,e,t){let n=i.name,s=n.length;for(Bc.lastIndex=0;;){let r=Bc.exec(n),o=Bc.lastIndex,a=r[1],c=r[2]==="]",l=r[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===s){Wd(t,l===void 0?new zc(a,i,e):new kc(a,i,e));break}else{let h=t.map[a];h===void 0&&(h=new Hc(a),Wd(t,h)),t=h}}}var Ns=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){let r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);zx(r,o,this)}}setValue(e,t,n,s){let r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){let s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){let a=t[r],c=n[a.id];c.needsUpdate!==!1&&a.setValue(e,c.value,s)}}static seqWithValue(e,t){let n=[];for(let s=0,r=e.length;s!==r;++s){let o=e[s];o.id in t&&n.push(o)}return n}};function Xd(i,e,t){let n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}var kx=37297,Hx=0;function Vx(i,e){let t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){let a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}var Yd=new Ge;function Gx(i){Ke._getMatrix(Yd,Ke.workingColorSpace,i);let e=`mat3( ${Yd.elements.map(t=>t.toFixed(4))} )`;switch(Ke.getTransfer(i)){case sr:return[e,"LinearTransferOETF"];case at:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",i),[e,"LinearTransferOETF"]}}function qd(i,e,t){let n=i.getShaderParameter(e,i.COMPILE_STATUS),r=(i.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";let o=/ERROR: 0:(\d+)/.exec(r);if(o){let a=parseInt(o[1]);return t.toUpperCase()+`

`+r+`

`+Vx(i.getShaderSource(e),a)}else return r}function Wx(i,e){let t=Gx(e);return[`vec4 ${i}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function Xx(i,e){let t;switch(e){case ad:t="Linear";break;case ld:t="Reinhard";break;case cd:t="Cineon";break;case oa:t="ACESFilmic";break;case hd:t="AgX";break;case dd:t="Neutral";break;case ud:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}var ja=new L;function Yx(){Ke.getLuminanceCoefficients(ja);let i=ja.x.toFixed(4),e=ja.y.toFixed(4),t=ja.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${i}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function qx(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",i.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Vr).join(`
`)}function $x(i){let e=[];for(let t in i){let n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function jx(i,e){let t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){let r=i.getActiveAttrib(e,s),o=r.name,a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function Vr(i){return i!==""}function $d(i,e){let t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function jd(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}var Kx=/^[ \t]*#include +<([\w\d./]+)>/gm;function Vc(i){return i.replace(Kx,Jx)}var Zx=new Map;function Jx(i,e){let t=We[e];if(t===void 0){let n=Zx.get(e);if(n!==void 0)t=We[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Vc(t)}var Qx=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Kd(i){return i.replace(Qx,ey)}function ey(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Zd(i){let e=`precision ${i.precision} float;
	precision ${i.precision} int;
	precision ${i.precision} sampler2D;
	precision ${i.precision} samplerCube;
	precision ${i.precision} sampler3D;
	precision ${i.precision} sampler2DArray;
	precision ${i.precision} sampler2DShadow;
	precision ${i.precision} samplerCubeShadow;
	precision ${i.precision} sampler2DArrayShadow;
	precision ${i.precision} isampler2D;
	precision ${i.precision} isampler3D;
	precision ${i.precision} isamplerCube;
	precision ${i.precision} isampler2DArray;
	precision ${i.precision} usampler2D;
	precision ${i.precision} usampler3D;
	precision ${i.precision} usamplerCube;
	precision ${i.precision} usampler2DArray;
	`;return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function ty(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===dc?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===kh?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===Nn&&(e="SHADOWMAP_TYPE_VSM"),e}function ny(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Oi:case Ui:e="ENVMAP_TYPE_CUBE";break;case Or:e="ENVMAP_TYPE_CUBE_UV";break}return e}function iy(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ui:e="ENVMAP_MODE_REFRACTION";break}return e}function sy(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case ra:e="ENVMAP_BLENDING_MULTIPLY";break;case rd:e="ENVMAP_BLENDING_MIX";break;case od:e="ENVMAP_BLENDING_ADD";break}return e}function ry(i){let e=i.envMapCubeUVHeight;if(e===null)return null;let t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function oy(i,e,t,n){let s=i.getContext(),r=t.defines,o=t.vertexShader,a=t.fragmentShader,c=ty(t),l=ny(t),u=iy(t),h=sy(t),d=ry(t),p=qx(t),g=$x(r),x=s.createProgram(),m,f,T=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Vr).join(`
`),m.length>0&&(m+=`
`),f=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(Vr).join(`
`),f.length>0&&(f+=`
`)):(m=[Zd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Vr).join(`
`),f=[Zd(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+u:"",t.envMap?"#define "+h:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Zn?"#define TONE_MAPPING":"",t.toneMapping!==Zn?We.tonemapping_pars_fragment:"",t.toneMapping!==Zn?Xx("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",We.colorspace_pars_fragment,Wx("linearToOutputTexel",t.outputColorSpace),Yx(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Vr).join(`
`)),o=Vc(o),o=$d(o,t),o=jd(o,t),a=Vc(a),a=$d(a,t),a=jd(a,t),o=Kd(o),a=Kd(a),t.isRawShaderMaterial!==!0&&(T=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,f=["#define varying in",t.glslVersion===Ac?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Ac?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+f);let b=T+m+o,M=T+f+a,A=Xd(s,s.VERTEX_SHADER,b),E=Xd(s,s.FRAGMENT_SHADER,M);s.attachShader(x,A),s.attachShader(x,E),t.index0AttributeName!==void 0?s.bindAttribLocation(x,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(x,0,"position"),s.linkProgram(x);function C(P){if(i.debug.checkShaderErrors){let F=s.getProgramInfoLog(x)||"",k=s.getShaderInfoLog(A)||"",H=s.getShaderInfoLog(E)||"",q=F.trim(),W=k.trim(),te=H.trim(),V=!0,oe=!0;if(s.getProgramParameter(x,s.LINK_STATUS)===!1)if(V=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,x,A,E);else{let ce=qd(s,A,"vertex"),Te=qd(s,E,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(x,s.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+q+`
`+ce+`
`+Te)}else q!==""?console.warn("THREE.WebGLProgram: Program Info Log:",q):(W===""||te==="")&&(oe=!1);oe&&(P.diagnostics={runnable:V,programLog:q,vertexShader:{log:W,prefix:m},fragmentShader:{log:te,prefix:f}})}s.deleteShader(A),s.deleteShader(E),D=new Ns(s,x),S=jx(s,x)}let D;this.getUniforms=function(){return D===void 0&&C(this),D};let S;this.getAttributes=function(){return S===void 0&&C(this),S};let y=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=s.getProgramParameter(x,kx)),y},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(x),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Hx++,this.cacheKey=e,this.usedTimes=1,this.program=x,this.vertexShader=A,this.fragmentShader=E,this}var ay=0,Gc=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){let t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Wc(e),t.set(e,n)),n}},Wc=class{constructor(e){this.id=ay++,this.code=e,this.usedTimes=0}};function ly(i,e,t,n,s,r,o){let a=new ar,c=new Gc,l=new Set,u=[],h=s.logarithmicDepthBuffer,d=s.vertexTextures,p=s.precision,g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function x(S){return l.add(S),S===0?"uv":`uv${S}`}function m(S,y,P,F,k){let H=F.fog,q=k.geometry,W=S.isMeshStandardMaterial?F.environment:null,te=(S.isMeshStandardMaterial?t:e).get(S.envMap||W),V=te&&te.mapping===Or?te.image.height:null,oe=g[S.type];S.precision!==null&&(p=s.getMaxPrecision(S.precision),p!==S.precision&&console.warn("THREE.WebGLProgram.getParameters:",S.precision,"not supported, using",p,"instead."));let ce=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,Te=ce!==void 0?ce.length:0,re=0;q.morphAttributes.position!==void 0&&(re=1),q.morphAttributes.normal!==void 0&&(re=2),q.morphAttributes.color!==void 0&&(re=3);let ae,Oe,Re,G;if(oe){let Ye=On[oe];ae=Ye.vertexShader,Oe=Ye.fragmentShader}else ae=S.vertexShader,Oe=S.fragmentShader,c.update(S),Re=c.getVertexShaderID(S),G=c.getFragmentShaderID(S);let K=i.getRenderTarget(),de=i.state.buffers.depth.getReversed(),Ce=k.isInstancedMesh===!0,_e=k.isBatchedMesh===!0,He=!!S.map,pt=!!S.matcap,I=!!te,et=!!S.aoMap,Ue=!!S.lightMap,Le=!!S.bumpMap,ye=!!S.normalMap,dt=!!S.displacementMap,xe=!!S.emissiveMap,ze=!!S.metalnessMap,mt=!!S.roughnessMap,Ze=S.anisotropy>0,R=S.clearcoat>0,v=S.dispersion>0,z=S.iridescence>0,Y=S.sheen>0,Z=S.transmission>0,X=Ze&&!!S.anisotropyMap,Ee=R&&!!S.clearcoatMap,J=R&&!!S.clearcoatNormalMap,ge=R&&!!S.clearcoatRoughnessMap,Se=z&&!!S.iridescenceMap,Q=z&&!!S.iridescenceThicknessMap,ue=Y&&!!S.sheenColorMap,Ne=Y&&!!S.sheenRoughnessMap,ve=!!S.specularMap,le=!!S.specularColorMap,ke=!!S.specularIntensityMap,O=Z&&!!S.transmissionMap,ne=Z&&!!S.thicknessMap,se=!!S.gradientMap,fe=!!S.alphaMap,ee=S.alphaTest>0,$=!!S.alphaHash,Me=!!S.extensions,Fe=Zn;S.toneMapped&&(K===null||K.isXRRenderTarget===!0)&&(Fe=i.toneMapping);let st={shaderID:oe,shaderType:S.type,shaderName:S.name,vertexShader:ae,fragmentShader:Oe,defines:S.defines,customVertexShaderID:Re,customFragmentShaderID:G,isRawShaderMaterial:S.isRawShaderMaterial===!0,glslVersion:S.glslVersion,precision:p,batching:_e,batchingColor:_e&&k._colorsTexture!==null,instancing:Ce,instancingColor:Ce&&k.instanceColor!==null,instancingMorph:Ce&&k.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:K===null?i.outputColorSpace:K.isXRRenderTarget===!0?K.texture.colorSpace:Lt,alphaToCoverage:!!S.alphaToCoverage,map:He,matcap:pt,envMap:I,envMapMode:I&&te.mapping,envMapCubeUVHeight:V,aoMap:et,lightMap:Ue,bumpMap:Le,normalMap:ye,displacementMap:d&&dt,emissiveMap:xe,normalMapObjectSpace:ye&&S.normalMapType===_d,normalMapTangentSpace:ye&&S.normalMapType===Xa,metalnessMap:ze,roughnessMap:mt,anisotropy:Ze,anisotropyMap:X,clearcoat:R,clearcoatMap:Ee,clearcoatNormalMap:J,clearcoatRoughnessMap:ge,dispersion:v,iridescence:z,iridescenceMap:Se,iridescenceThicknessMap:Q,sheen:Y,sheenColorMap:ue,sheenRoughnessMap:Ne,specularMap:ve,specularColorMap:le,specularIntensityMap:ke,transmission:Z,transmissionMap:O,thicknessMap:ne,gradientMap:se,opaque:S.transparent===!1&&S.blending===Si&&S.alphaToCoverage===!1,alphaMap:fe,alphaTest:ee,alphaHash:$,combine:S.combine,mapUv:He&&x(S.map.channel),aoMapUv:et&&x(S.aoMap.channel),lightMapUv:Ue&&x(S.lightMap.channel),bumpMapUv:Le&&x(S.bumpMap.channel),normalMapUv:ye&&x(S.normalMap.channel),displacementMapUv:dt&&x(S.displacementMap.channel),emissiveMapUv:xe&&x(S.emissiveMap.channel),metalnessMapUv:ze&&x(S.metalnessMap.channel),roughnessMapUv:mt&&x(S.roughnessMap.channel),anisotropyMapUv:X&&x(S.anisotropyMap.channel),clearcoatMapUv:Ee&&x(S.clearcoatMap.channel),clearcoatNormalMapUv:J&&x(S.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ge&&x(S.clearcoatRoughnessMap.channel),iridescenceMapUv:Se&&x(S.iridescenceMap.channel),iridescenceThicknessMapUv:Q&&x(S.iridescenceThicknessMap.channel),sheenColorMapUv:ue&&x(S.sheenColorMap.channel),sheenRoughnessMapUv:Ne&&x(S.sheenRoughnessMap.channel),specularMapUv:ve&&x(S.specularMap.channel),specularColorMapUv:le&&x(S.specularColorMap.channel),specularIntensityMapUv:ke&&x(S.specularIntensityMap.channel),transmissionMapUv:O&&x(S.transmissionMap.channel),thicknessMapUv:ne&&x(S.thicknessMap.channel),alphaMapUv:fe&&x(S.alphaMap.channel),vertexTangents:!!q.attributes.tangent&&(ye||Ze),vertexColors:S.vertexColors,vertexAlphas:S.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,pointsUvs:k.isPoints===!0&&!!q.attributes.uv&&(He||fe),fog:!!H,useFog:S.fog===!0,fogExp2:!!H&&H.isFogExp2,flatShading:S.flatShading===!0&&S.wireframe===!1,sizeAttenuation:S.sizeAttenuation===!0,logarithmicDepthBuffer:h,reversedDepthBuffer:de,skinning:k.isSkinnedMesh===!0,morphTargets:q.morphAttributes.position!==void 0,morphNormals:q.morphAttributes.normal!==void 0,morphColors:q.morphAttributes.color!==void 0,morphTargetsCount:Te,morphTextureStride:re,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:S.dithering,shadowMapEnabled:i.shadowMap.enabled&&P.length>0,shadowMapType:i.shadowMap.type,toneMapping:Fe,decodeVideoTexture:He&&S.map.isVideoTexture===!0&&Ke.getTransfer(S.map.colorSpace)===at,decodeVideoTextureEmissive:xe&&S.emissiveMap.isVideoTexture===!0&&Ke.getTransfer(S.emissiveMap.colorSpace)===at,premultipliedAlpha:S.premultipliedAlpha,doubleSided:S.side===Bt,flipSided:S.side===Et,useDepthPacking:S.depthPacking>=0,depthPacking:S.depthPacking||0,index0AttributeName:S.index0AttributeName,extensionClipCullDistance:Me&&S.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Me&&S.extensions.multiDraw===!0||_e)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:S.customProgramCacheKey()};return st.vertexUv1s=l.has(1),st.vertexUv2s=l.has(2),st.vertexUv3s=l.has(3),l.clear(),st}function f(S){let y=[];if(S.shaderID?y.push(S.shaderID):(y.push(S.customVertexShaderID),y.push(S.customFragmentShaderID)),S.defines!==void 0)for(let P in S.defines)y.push(P),y.push(S.defines[P]);return S.isRawShaderMaterial===!1&&(T(y,S),b(y,S),y.push(i.outputColorSpace)),y.push(S.customProgramCacheKey),y.join()}function T(S,y){S.push(y.precision),S.push(y.outputColorSpace),S.push(y.envMapMode),S.push(y.envMapCubeUVHeight),S.push(y.mapUv),S.push(y.alphaMapUv),S.push(y.lightMapUv),S.push(y.aoMapUv),S.push(y.bumpMapUv),S.push(y.normalMapUv),S.push(y.displacementMapUv),S.push(y.emissiveMapUv),S.push(y.metalnessMapUv),S.push(y.roughnessMapUv),S.push(y.anisotropyMapUv),S.push(y.clearcoatMapUv),S.push(y.clearcoatNormalMapUv),S.push(y.clearcoatRoughnessMapUv),S.push(y.iridescenceMapUv),S.push(y.iridescenceThicknessMapUv),S.push(y.sheenColorMapUv),S.push(y.sheenRoughnessMapUv),S.push(y.specularMapUv),S.push(y.specularColorMapUv),S.push(y.specularIntensityMapUv),S.push(y.transmissionMapUv),S.push(y.thicknessMapUv),S.push(y.combine),S.push(y.fogExp2),S.push(y.sizeAttenuation),S.push(y.morphTargetsCount),S.push(y.morphAttributeCount),S.push(y.numDirLights),S.push(y.numPointLights),S.push(y.numSpotLights),S.push(y.numSpotLightMaps),S.push(y.numHemiLights),S.push(y.numRectAreaLights),S.push(y.numDirLightShadows),S.push(y.numPointLightShadows),S.push(y.numSpotLightShadows),S.push(y.numSpotLightShadowsWithMaps),S.push(y.numLightProbes),S.push(y.shadowMapType),S.push(y.toneMapping),S.push(y.numClippingPlanes),S.push(y.numClipIntersection),S.push(y.depthPacking)}function b(S,y){a.disableAll(),y.supportsVertexTextures&&a.enable(0),y.instancing&&a.enable(1),y.instancingColor&&a.enable(2),y.instancingMorph&&a.enable(3),y.matcap&&a.enable(4),y.envMap&&a.enable(5),y.normalMapObjectSpace&&a.enable(6),y.normalMapTangentSpace&&a.enable(7),y.clearcoat&&a.enable(8),y.iridescence&&a.enable(9),y.alphaTest&&a.enable(10),y.vertexColors&&a.enable(11),y.vertexAlphas&&a.enable(12),y.vertexUv1s&&a.enable(13),y.vertexUv2s&&a.enable(14),y.vertexUv3s&&a.enable(15),y.vertexTangents&&a.enable(16),y.anisotropy&&a.enable(17),y.alphaHash&&a.enable(18),y.batching&&a.enable(19),y.dispersion&&a.enable(20),y.batchingColor&&a.enable(21),y.gradientMap&&a.enable(22),S.push(a.mask),a.disableAll(),y.fog&&a.enable(0),y.useFog&&a.enable(1),y.flatShading&&a.enable(2),y.logarithmicDepthBuffer&&a.enable(3),y.reversedDepthBuffer&&a.enable(4),y.skinning&&a.enable(5),y.morphTargets&&a.enable(6),y.morphNormals&&a.enable(7),y.morphColors&&a.enable(8),y.premultipliedAlpha&&a.enable(9),y.shadowMapEnabled&&a.enable(10),y.doubleSided&&a.enable(11),y.flipSided&&a.enable(12),y.useDepthPacking&&a.enable(13),y.dithering&&a.enable(14),y.transmission&&a.enable(15),y.sheen&&a.enable(16),y.opaque&&a.enable(17),y.pointsUvs&&a.enable(18),y.decodeVideoTexture&&a.enable(19),y.decodeVideoTextureEmissive&&a.enable(20),y.alphaToCoverage&&a.enable(21),S.push(a.mask)}function M(S){let y=g[S.type],P;if(y){let F=On[y];P=Rd.clone(F.uniforms)}else P=S.uniforms;return P}function A(S,y){let P;for(let F=0,k=u.length;F<k;F++){let H=u[F];if(H.cacheKey===y){P=H,++P.usedTimes;break}}return P===void 0&&(P=new oy(i,y,S,r),u.push(P)),P}function E(S){if(--S.usedTimes===0){let y=u.indexOf(S);u[y]=u[u.length-1],u.pop(),S.destroy()}}function C(S){c.remove(S)}function D(){c.dispose()}return{getParameters:m,getProgramCacheKey:f,getUniforms:M,acquireProgram:A,releaseProgram:E,releaseShaderCache:C,programs:u,dispose:D}}function cy(){let i=new WeakMap;function e(o){return i.has(o)}function t(o){let a=i.get(o);return a===void 0&&(a={},i.set(o,a)),a}function n(o){i.delete(o)}function s(o,a,c){i.get(o)[a]=c}function r(){i=new WeakMap}return{has:e,get:t,remove:n,update:s,dispose:r}}function uy(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Jd(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function Qd(){let i=[],e=0,t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(h,d,p,g,x,m){let f=i[e];return f===void 0?(f={id:h.id,object:h,geometry:d,material:p,groupOrder:g,renderOrder:h.renderOrder,z:x,group:m},i[e]=f):(f.id=h.id,f.object=h,f.geometry=d,f.material=p,f.groupOrder=g,f.renderOrder=h.renderOrder,f.z=x,f.group=m),e++,f}function a(h,d,p,g,x,m){let f=o(h,d,p,g,x,m);p.transmission>0?n.push(f):p.transparent===!0?s.push(f):t.push(f)}function c(h,d,p,g,x,m){let f=o(h,d,p,g,x,m);p.transmission>0?n.unshift(f):p.transparent===!0?s.unshift(f):t.unshift(f)}function l(h,d){t.length>1&&t.sort(h||uy),n.length>1&&n.sort(d||Jd),s.length>1&&s.sort(d||Jd)}function u(){for(let h=e,d=i.length;h<d;h++){let p=i[h];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:c,finish:u,sort:l}}function hy(){let i=new WeakMap;function e(n,s){let r=i.get(n),o;return r===void 0?(o=new Qd,i.set(n,[o])):s>=r.length?(o=new Qd,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function dy(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new L,color:new Pe};break;case"SpotLight":t={position:new L,direction:new L,color:new Pe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new L,color:new Pe,distance:0,decay:0};break;case"HemisphereLight":t={direction:new L,skyColor:new Pe,groundColor:new Pe};break;case"RectAreaLight":t={color:new Pe,position:new L,halfWidth:new L,halfHeight:new L};break}return i[e.id]=t,t}}}function fy(){let i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new we,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}var py=0;function my(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function gy(i){let e=new dy,t=fy(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new L);let s=new L,r=new Ve,o=new Ve;function a(l){let u=0,h=0,d=0;for(let S=0;S<9;S++)n.probe[S].set(0,0,0);let p=0,g=0,x=0,m=0,f=0,T=0,b=0,M=0,A=0,E=0,C=0;l.sort(my);for(let S=0,y=l.length;S<y;S++){let P=l[S],F=P.color,k=P.intensity,H=P.distance,q=P.shadow&&P.shadow.map?P.shadow.map.texture:null;if(P.isAmbientLight)u+=F.r*k,h+=F.g*k,d+=F.b*k;else if(P.isLightProbe){for(let W=0;W<9;W++)n.probe[W].addScaledVector(P.sh.coefficients[W],k);C++}else if(P.isDirectionalLight){let W=e.get(P);if(W.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){let te=P.shadow,V=t.get(P);V.shadowIntensity=te.intensity,V.shadowBias=te.bias,V.shadowNormalBias=te.normalBias,V.shadowRadius=te.radius,V.shadowMapSize=te.mapSize,n.directionalShadow[p]=V,n.directionalShadowMap[p]=q,n.directionalShadowMatrix[p]=P.shadow.matrix,T++}n.directional[p]=W,p++}else if(P.isSpotLight){let W=e.get(P);W.position.setFromMatrixPosition(P.matrixWorld),W.color.copy(F).multiplyScalar(k),W.distance=H,W.coneCos=Math.cos(P.angle),W.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),W.decay=P.decay,n.spot[x]=W;let te=P.shadow;if(P.map&&(n.spotLightMap[A]=P.map,A++,te.updateMatrices(P),P.castShadow&&E++),n.spotLightMatrix[x]=te.matrix,P.castShadow){let V=t.get(P);V.shadowIntensity=te.intensity,V.shadowBias=te.bias,V.shadowNormalBias=te.normalBias,V.shadowRadius=te.radius,V.shadowMapSize=te.mapSize,n.spotShadow[x]=V,n.spotShadowMap[x]=q,M++}x++}else if(P.isRectAreaLight){let W=e.get(P);W.color.copy(F).multiplyScalar(k),W.halfWidth.set(P.width*.5,0,0),W.halfHeight.set(0,P.height*.5,0),n.rectArea[m]=W,m++}else if(P.isPointLight){let W=e.get(P);if(W.color.copy(P.color).multiplyScalar(P.intensity),W.distance=P.distance,W.decay=P.decay,P.castShadow){let te=P.shadow,V=t.get(P);V.shadowIntensity=te.intensity,V.shadowBias=te.bias,V.shadowNormalBias=te.normalBias,V.shadowRadius=te.radius,V.shadowMapSize=te.mapSize,V.shadowCameraNear=te.camera.near,V.shadowCameraFar=te.camera.far,n.pointShadow[g]=V,n.pointShadowMap[g]=q,n.pointShadowMatrix[g]=P.shadow.matrix,b++}n.point[g]=W,g++}else if(P.isHemisphereLight){let W=e.get(P);W.skyColor.copy(P.color).multiplyScalar(k),W.groundColor.copy(P.groundColor).multiplyScalar(k),n.hemi[f]=W,f++}}m>0&&(i.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=he.LTC_FLOAT_1,n.rectAreaLTC2=he.LTC_FLOAT_2):(n.rectAreaLTC1=he.LTC_HALF_1,n.rectAreaLTC2=he.LTC_HALF_2)),n.ambient[0]=u,n.ambient[1]=h,n.ambient[2]=d;let D=n.hash;(D.directionalLength!==p||D.pointLength!==g||D.spotLength!==x||D.rectAreaLength!==m||D.hemiLength!==f||D.numDirectionalShadows!==T||D.numPointShadows!==b||D.numSpotShadows!==M||D.numSpotMaps!==A||D.numLightProbes!==C)&&(n.directional.length=p,n.spot.length=x,n.rectArea.length=m,n.point.length=g,n.hemi.length=f,n.directionalShadow.length=T,n.directionalShadowMap.length=T,n.pointShadow.length=b,n.pointShadowMap.length=b,n.spotShadow.length=M,n.spotShadowMap.length=M,n.directionalShadowMatrix.length=T,n.pointShadowMatrix.length=b,n.spotLightMatrix.length=M+A-E,n.spotLightMap.length=A,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=C,D.directionalLength=p,D.pointLength=g,D.spotLength=x,D.rectAreaLength=m,D.hemiLength=f,D.numDirectionalShadows=T,D.numPointShadows=b,D.numSpotShadows=M,D.numSpotMaps=A,D.numLightProbes=C,n.version=py++)}function c(l,u){let h=0,d=0,p=0,g=0,x=0,m=u.matrixWorldInverse;for(let f=0,T=l.length;f<T;f++){let b=l[f];if(b.isDirectionalLight){let M=n.directional[h];M.direction.setFromMatrixPosition(b.matrixWorld),s.setFromMatrixPosition(b.target.matrixWorld),M.direction.sub(s),M.direction.transformDirection(m),h++}else if(b.isSpotLight){let M=n.spot[p];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),M.direction.setFromMatrixPosition(b.matrixWorld),s.setFromMatrixPosition(b.target.matrixWorld),M.direction.sub(s),M.direction.transformDirection(m),p++}else if(b.isRectAreaLight){let M=n.rectArea[g];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),o.identity(),r.copy(b.matrixWorld),r.premultiply(m),o.extractRotation(r),M.halfWidth.set(b.width*.5,0,0),M.halfHeight.set(0,b.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),g++}else if(b.isPointLight){let M=n.point[d];M.position.setFromMatrixPosition(b.matrixWorld),M.position.applyMatrix4(m),d++}else if(b.isHemisphereLight){let M=n.hemi[x];M.direction.setFromMatrixPosition(b.matrixWorld),M.direction.transformDirection(m),x++}}}return{setup:a,setupView:c,state:n}}function ef(i){let e=new gy(i),t=[],n=[];function s(u){l.camera=u,t.length=0,n.length=0}function r(u){t.push(u)}function o(u){n.push(u)}function a(){e.setup(t)}function c(u){e.setupView(t,u)}let l={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:s,state:l,setupLights:a,setupLightsView:c,pushLight:r,pushShadow:o}}function _y(i){let e=new WeakMap;function t(s,r=0){let o=e.get(s),a;return o===void 0?(a=new ef(i),e.set(s,[a])):r>=o.length?(a=new ef(i),o.push(a)):a=o[r],a}function n(){e=new WeakMap}return{get:t,dispose:n}}var xy=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,yy=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function vy(i,e,t){let n=new Ms,s=new we,r=new we,o=new Je,a=new Go({depthPacking:gd}),c=new Wo,l={},u=t.maxTextureSize,h={[xn]:Et,[Et]:xn,[Bt]:Bt},d=new yn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new we},radius:{value:4}},vertexShader:xy,fragmentShader:yy}),p=d.clone();p.defines.HORIZONTAL_PASS=1;let g=new _t;g.setAttribute("position",new Mt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let x=new Qe(g,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=dc;let f=this.type;this.render=function(E,C,D){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||E.length===0)return;let S=i.getRenderTarget(),y=i.getActiveCubeFace(),P=i.getActiveMipmapLevel(),F=i.state;F.setBlending(Kn),F.buffers.depth.getReversed()===!0?F.buffers.color.setClear(0,0,0,0):F.buffers.color.setClear(1,1,1,1),F.buffers.depth.setTest(!0),F.setScissorTest(!1);let k=f!==Nn&&this.type===Nn,H=f===Nn&&this.type!==Nn;for(let q=0,W=E.length;q<W;q++){let te=E[q],V=te.shadow;if(V===void 0){console.warn("THREE.WebGLShadowMap:",te,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;s.copy(V.mapSize);let oe=V.getFrameExtents();if(s.multiply(oe),r.copy(V.mapSize),(s.x>u||s.y>u)&&(s.x>u&&(r.x=Math.floor(u/oe.x),s.x=r.x*oe.x,V.mapSize.x=r.x),s.y>u&&(r.y=Math.floor(u/oe.y),s.y=r.y*oe.y,V.mapSize.y=r.y)),V.map===null||k===!0||H===!0){let Te=this.type!==Nn?{minFilter:Pt,magFilter:Pt}:{};V.map!==null&&V.map.dispose(),V.map=new Rn(s.x,s.y,Te),V.map.texture.name=te.name+".shadowMap",V.camera.updateProjectionMatrix()}i.setRenderTarget(V.map),i.clear();let ce=V.getViewportCount();for(let Te=0;Te<ce;Te++){let re=V.getViewport(Te);o.set(r.x*re.x,r.y*re.y,r.x*re.z,r.y*re.w),F.viewport(o),V.updateMatrices(te,Te),n=V.getFrustum(),M(C,D,V.camera,te,this.type)}V.isPointLightShadow!==!0&&this.type===Nn&&T(V,D),V.needsUpdate=!1}f=this.type,m.needsUpdate=!1,i.setRenderTarget(S,y,P)};function T(E,C){let D=e.update(x);d.defines.VSM_SAMPLES!==E.blurSamples&&(d.defines.VSM_SAMPLES=E.blurSamples,p.defines.VSM_SAMPLES=E.blurSamples,d.needsUpdate=!0,p.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new Rn(s.x,s.y)),d.uniforms.shadow_pass.value=E.map.texture,d.uniforms.resolution.value=E.mapSize,d.uniforms.radius.value=E.radius,i.setRenderTarget(E.mapPass),i.clear(),i.renderBufferDirect(C,null,D,d,x,null),p.uniforms.shadow_pass.value=E.mapPass.texture,p.uniforms.resolution.value=E.mapSize,p.uniforms.radius.value=E.radius,i.setRenderTarget(E.map),i.clear(),i.renderBufferDirect(C,null,D,p,x,null)}function b(E,C,D,S){let y=null,P=D.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(P!==void 0)y=P;else if(y=D.isPointLight===!0?c:a,i.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){let F=y.uuid,k=C.uuid,H=l[F];H===void 0&&(H={},l[F]=H);let q=H[k];q===void 0&&(q=y.clone(),H[k]=q,C.addEventListener("dispose",A)),y=q}if(y.visible=C.visible,y.wireframe=C.wireframe,S===Nn?y.side=C.shadowSide!==null?C.shadowSide:C.side:y.side=C.shadowSide!==null?C.shadowSide:h[C.side],y.alphaMap=C.alphaMap,y.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,y.map=C.map,y.clipShadows=C.clipShadows,y.clippingPlanes=C.clippingPlanes,y.clipIntersection=C.clipIntersection,y.displacementMap=C.displacementMap,y.displacementScale=C.displacementScale,y.displacementBias=C.displacementBias,y.wireframeLinewidth=C.wireframeLinewidth,y.linewidth=C.linewidth,D.isPointLight===!0&&y.isMeshDistanceMaterial===!0){let F=i.properties.get(y);F.light=D}return y}function M(E,C,D,S,y){if(E.visible===!1)return;if(E.layers.test(C.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&y===Nn)&&(!E.frustumCulled||n.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(D.matrixWorldInverse,E.matrixWorld);let k=e.update(E),H=E.material;if(Array.isArray(H)){let q=k.groups;for(let W=0,te=q.length;W<te;W++){let V=q[W],oe=H[V.materialIndex];if(oe&&oe.visible){let ce=b(E,oe,S,y);E.onBeforeShadow(i,E,C,D,k,ce,V),i.renderBufferDirect(D,null,k,ce,E,V),E.onAfterShadow(i,E,C,D,k,ce,V)}}}else if(H.visible){let q=b(E,H,S,y);E.onBeforeShadow(i,E,C,D,k,q,null),i.renderBufferDirect(D,null,k,q,E,null),E.onAfterShadow(i,E,C,D,k,q,null)}}let F=E.children;for(let k=0,H=F.length;k<H;k++)M(F[k],C,D,S,y)}function A(E){E.target.removeEventListener("dispose",A);for(let D in l){let S=l[D],y=E.target.uuid;y in S&&(S[y].dispose(),delete S[y])}}}var Sy={[Jo]:Qo,[ea]:ia,[ta]:sa,[Mi]:na,[Qo]:Jo,[ia]:ea,[sa]:ta,[na]:Mi};function My(i,e){function t(){let O=!1,ne=new Je,se=null,fe=new Je(0,0,0,0);return{setMask:function(ee){se!==ee&&!O&&(i.colorMask(ee,ee,ee,ee),se=ee)},setLocked:function(ee){O=ee},setClear:function(ee,$,Me,Fe,st){st===!0&&(ee*=Fe,$*=Fe,Me*=Fe),ne.set(ee,$,Me,Fe),fe.equals(ne)===!1&&(i.clearColor(ee,$,Me,Fe),fe.copy(ne))},reset:function(){O=!1,se=null,fe.set(-1,0,0,0)}}}function n(){let O=!1,ne=!1,se=null,fe=null,ee=null;return{setReversed:function($){if(ne!==$){let Me=e.get("EXT_clip_control");$?Me.clipControlEXT(Me.LOWER_LEFT_EXT,Me.ZERO_TO_ONE_EXT):Me.clipControlEXT(Me.LOWER_LEFT_EXT,Me.NEGATIVE_ONE_TO_ONE_EXT),ne=$;let Fe=ee;ee=null,this.setClear(Fe)}},getReversed:function(){return ne},setTest:function($){$?K(i.DEPTH_TEST):de(i.DEPTH_TEST)},setMask:function($){se!==$&&!O&&(i.depthMask($),se=$)},setFunc:function($){if(ne&&($=Sy[$]),fe!==$){switch($){case Jo:i.depthFunc(i.NEVER);break;case Qo:i.depthFunc(i.ALWAYS);break;case ea:i.depthFunc(i.LESS);break;case Mi:i.depthFunc(i.LEQUAL);break;case ta:i.depthFunc(i.EQUAL);break;case na:i.depthFunc(i.GEQUAL);break;case ia:i.depthFunc(i.GREATER);break;case sa:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}fe=$}},setLocked:function($){O=$},setClear:function($){ee!==$&&(ne&&($=1-$),i.clearDepth($),ee=$)},reset:function(){O=!1,se=null,fe=null,ee=null,ne=!1}}}function s(){let O=!1,ne=null,se=null,fe=null,ee=null,$=null,Me=null,Fe=null,st=null;return{setTest:function(Ye){O||(Ye?K(i.STENCIL_TEST):de(i.STENCIL_TEST))},setMask:function(Ye){ne!==Ye&&!O&&(i.stencilMask(Ye),ne=Ye)},setFunc:function(Ye,nn,sn){(se!==Ye||fe!==nn||ee!==sn)&&(i.stencilFunc(Ye,nn,sn),se=Ye,fe=nn,ee=sn)},setOp:function(Ye,nn,sn){($!==Ye||Me!==nn||Fe!==sn)&&(i.stencilOp(Ye,nn,sn),$=Ye,Me=nn,Fe=sn)},setLocked:function(Ye){O=Ye},setClear:function(Ye){st!==Ye&&(i.clearStencil(Ye),st=Ye)},reset:function(){O=!1,ne=null,se=null,fe=null,ee=null,$=null,Me=null,Fe=null,st=null}}}let r=new t,o=new n,a=new s,c=new WeakMap,l=new WeakMap,u={},h={},d=new WeakMap,p=[],g=null,x=!1,m=null,f=null,T=null,b=null,M=null,A=null,E=null,C=new Pe(0,0,0),D=0,S=!1,y=null,P=null,F=null,k=null,H=null,q=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS),W=!1,te=0,V=i.getParameter(i.VERSION);V.indexOf("WebGL")!==-1?(te=parseFloat(/^WebGL (\d)/.exec(V)[1]),W=te>=1):V.indexOf("OpenGL ES")!==-1&&(te=parseFloat(/^OpenGL ES (\d)/.exec(V)[1]),W=te>=2);let oe=null,ce={},Te=i.getParameter(i.SCISSOR_BOX),re=i.getParameter(i.VIEWPORT),ae=new Je().fromArray(Te),Oe=new Je().fromArray(re);function Re(O,ne,se,fe){let ee=new Uint8Array(4),$=i.createTexture();i.bindTexture(O,$),i.texParameteri(O,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(O,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Me=0;Me<se;Me++)O===i.TEXTURE_3D||O===i.TEXTURE_2D_ARRAY?i.texImage3D(ne,0,i.RGBA,1,1,fe,0,i.RGBA,i.UNSIGNED_BYTE,ee):i.texImage2D(ne+Me,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,ee);return $}let G={};G[i.TEXTURE_2D]=Re(i.TEXTURE_2D,i.TEXTURE_2D,1),G[i.TEXTURE_CUBE_MAP]=Re(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),G[i.TEXTURE_2D_ARRAY]=Re(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),G[i.TEXTURE_3D]=Re(i.TEXTURE_3D,i.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),K(i.DEPTH_TEST),o.setFunc(Mi),Le(!1),ye(hc),K(i.CULL_FACE),et(Kn);function K(O){u[O]!==!0&&(i.enable(O),u[O]=!0)}function de(O){u[O]!==!1&&(i.disable(O),u[O]=!1)}function Ce(O,ne){return h[O]!==ne?(i.bindFramebuffer(O,ne),h[O]=ne,O===i.DRAW_FRAMEBUFFER&&(h[i.FRAMEBUFFER]=ne),O===i.FRAMEBUFFER&&(h[i.DRAW_FRAMEBUFFER]=ne),!0):!1}function _e(O,ne){let se=p,fe=!1;if(O){se=d.get(ne),se===void 0&&(se=[],d.set(ne,se));let ee=O.textures;if(se.length!==ee.length||se[0]!==i.COLOR_ATTACHMENT0){for(let $=0,Me=ee.length;$<Me;$++)se[$]=i.COLOR_ATTACHMENT0+$;se.length=ee.length,fe=!0}}else se[0]!==i.BACK&&(se[0]=i.BACK,fe=!0);fe&&i.drawBuffers(se)}function He(O){return g!==O?(i.useProgram(O),g=O,!0):!1}let pt={[ri]:i.FUNC_ADD,[Vh]:i.FUNC_SUBTRACT,[Gh]:i.FUNC_REVERSE_SUBTRACT};pt[Wh]=i.MIN,pt[Xh]=i.MAX;let I={[Yh]:i.ZERO,[qh]:i.ONE,[$h]:i.SRC_COLOR,[Po]:i.SRC_ALPHA,[ed]:i.SRC_ALPHA_SATURATE,[Jh]:i.DST_COLOR,[Kh]:i.DST_ALPHA,[jh]:i.ONE_MINUS_SRC_COLOR,[Lo]:i.ONE_MINUS_SRC_ALPHA,[Qh]:i.ONE_MINUS_DST_COLOR,[Zh]:i.ONE_MINUS_DST_ALPHA,[td]:i.CONSTANT_COLOR,[nd]:i.ONE_MINUS_CONSTANT_COLOR,[id]:i.CONSTANT_ALPHA,[sd]:i.ONE_MINUS_CONSTANT_ALPHA};function et(O,ne,se,fe,ee,$,Me,Fe,st,Ye){if(O===Kn){x===!0&&(de(i.BLEND),x=!1);return}if(x===!1&&(K(i.BLEND),x=!0),O!==Hh){if(O!==m||Ye!==S){if((f!==ri||M!==ri)&&(i.blendEquation(i.FUNC_ADD),f=ri,M=ri),Ye)switch(O){case Si:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case fc:i.blendFunc(i.ONE,i.ONE);break;case pc:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case mc:i.blendFuncSeparate(i.DST_COLOR,i.ONE_MINUS_SRC_ALPHA,i.ZERO,i.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",O);break}else switch(O){case Si:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case fc:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE,i.ONE,i.ONE);break;case pc:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case mc:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",O);break}T=null,b=null,A=null,E=null,C.set(0,0,0),D=0,m=O,S=Ye}return}ee=ee||ne,$=$||se,Me=Me||fe,(ne!==f||ee!==M)&&(i.blendEquationSeparate(pt[ne],pt[ee]),f=ne,M=ee),(se!==T||fe!==b||$!==A||Me!==E)&&(i.blendFuncSeparate(I[se],I[fe],I[$],I[Me]),T=se,b=fe,A=$,E=Me),(Fe.equals(C)===!1||st!==D)&&(i.blendColor(Fe.r,Fe.g,Fe.b,st),C.copy(Fe),D=st),m=O,S=!1}function Ue(O,ne){O.side===Bt?de(i.CULL_FACE):K(i.CULL_FACE);let se=O.side===Et;ne&&(se=!se),Le(se),O.blending===Si&&O.transparent===!1?et(Kn):et(O.blending,O.blendEquation,O.blendSrc,O.blendDst,O.blendEquationAlpha,O.blendSrcAlpha,O.blendDstAlpha,O.blendColor,O.blendAlpha,O.premultipliedAlpha),o.setFunc(O.depthFunc),o.setTest(O.depthTest),o.setMask(O.depthWrite),r.setMask(O.colorWrite);let fe=O.stencilWrite;a.setTest(fe),fe&&(a.setMask(O.stencilWriteMask),a.setFunc(O.stencilFunc,O.stencilRef,O.stencilFuncMask),a.setOp(O.stencilFail,O.stencilZFail,O.stencilZPass)),xe(O.polygonOffset,O.polygonOffsetFactor,O.polygonOffsetUnits),O.alphaToCoverage===!0?K(i.SAMPLE_ALPHA_TO_COVERAGE):de(i.SAMPLE_ALPHA_TO_COVERAGE)}function Le(O){y!==O&&(O?i.frontFace(i.CW):i.frontFace(i.CCW),y=O)}function ye(O){O!==Bh?(K(i.CULL_FACE),O!==P&&(O===hc?i.cullFace(i.BACK):O===zh?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):de(i.CULL_FACE),P=O}function dt(O){O!==F&&(W&&i.lineWidth(O),F=O)}function xe(O,ne,se){O?(K(i.POLYGON_OFFSET_FILL),(k!==ne||H!==se)&&(i.polygonOffset(ne,se),k=ne,H=se)):de(i.POLYGON_OFFSET_FILL)}function ze(O){O?K(i.SCISSOR_TEST):de(i.SCISSOR_TEST)}function mt(O){O===void 0&&(O=i.TEXTURE0+q-1),oe!==O&&(i.activeTexture(O),oe=O)}function Ze(O,ne,se){se===void 0&&(oe===null?se=i.TEXTURE0+q-1:se=oe);let fe=ce[se];fe===void 0&&(fe={type:void 0,texture:void 0},ce[se]=fe),(fe.type!==O||fe.texture!==ne)&&(oe!==se&&(i.activeTexture(se),oe=se),i.bindTexture(O,ne||G[O]),fe.type=O,fe.texture=ne)}function R(){let O=ce[oe];O!==void 0&&O.type!==void 0&&(i.bindTexture(O.type,null),O.type=void 0,O.texture=void 0)}function v(){try{i.compressedTexImage2D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function z(){try{i.compressedTexImage3D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function Y(){try{i.texSubImage2D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function Z(){try{i.texSubImage3D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function X(){try{i.compressedTexSubImage2D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function Ee(){try{i.compressedTexSubImage3D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function J(){try{i.texStorage2D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function ge(){try{i.texStorage3D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function Se(){try{i.texImage2D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function Q(){try{i.texImage3D(...arguments)}catch(O){console.error("THREE.WebGLState:",O)}}function ue(O){ae.equals(O)===!1&&(i.scissor(O.x,O.y,O.z,O.w),ae.copy(O))}function Ne(O){Oe.equals(O)===!1&&(i.viewport(O.x,O.y,O.z,O.w),Oe.copy(O))}function ve(O,ne){let se=l.get(ne);se===void 0&&(se=new WeakMap,l.set(ne,se));let fe=se.get(O);fe===void 0&&(fe=i.getUniformBlockIndex(ne,O.name),se.set(O,fe))}function le(O,ne){let fe=l.get(ne).get(O);c.get(ne)!==fe&&(i.uniformBlockBinding(ne,fe,O.__bindingPointIndex),c.set(ne,fe))}function ke(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),o.setReversed(!1),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),u={},oe=null,ce={},h={},d=new WeakMap,p=[],g=null,x=!1,m=null,f=null,T=null,b=null,M=null,A=null,E=null,C=new Pe(0,0,0),D=0,S=!1,y=null,P=null,F=null,k=null,H=null,ae.set(0,0,i.canvas.width,i.canvas.height),Oe.set(0,0,i.canvas.width,i.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:K,disable:de,bindFramebuffer:Ce,drawBuffers:_e,useProgram:He,setBlending:et,setMaterial:Ue,setFlipSided:Le,setCullFace:ye,setLineWidth:dt,setPolygonOffset:xe,setScissorTest:ze,activeTexture:mt,bindTexture:Ze,unbindTexture:R,compressedTexImage2D:v,compressedTexImage3D:z,texImage2D:Se,texImage3D:Q,updateUBOMapping:ve,uniformBlockBinding:le,texStorage2D:J,texStorage3D:ge,texSubImage2D:Y,texSubImage3D:Z,compressedTexSubImage2D:X,compressedTexSubImage3D:Ee,scissor:ue,viewport:Ne,reset:ke}}function by(i,e,t,n,s,r,o){let a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new we,u=new WeakMap,h,d=new WeakMap,p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(R,v){return p?new OffscreenCanvas(R,v):gs("canvas")}function x(R,v,z){let Y=1,Z=Ze(R);if((Z.width>z||Z.height>z)&&(Y=z/Math.max(Z.width,Z.height)),Y<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){let X=Math.floor(Y*Z.width),Ee=Math.floor(Y*Z.height);h===void 0&&(h=g(X,Ee));let J=v?g(X,Ee):h;return J.width=X,J.height=Ee,J.getContext("2d").drawImage(R,0,0,X,Ee),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Z.width+"x"+Z.height+") to ("+X+"x"+Ee+")."),J}else return"data"in R&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Z.width+"x"+Z.height+")."),R;return R}function m(R){return R.generateMipmaps}function f(R){i.generateMipmap(R)}function T(R){return R.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?i.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?i.TEXTURE_2D_ARRAY:i.TEXTURE_2D}function b(R,v,z,Y,Z=!1){if(R!==null){if(i[R]!==void 0)return i[R];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let X=v;if(v===i.RED&&(z===i.FLOAT&&(X=i.R32F),z===i.HALF_FLOAT&&(X=i.R16F),z===i.UNSIGNED_BYTE&&(X=i.R8)),v===i.RED_INTEGER&&(z===i.UNSIGNED_BYTE&&(X=i.R8UI),z===i.UNSIGNED_SHORT&&(X=i.R16UI),z===i.UNSIGNED_INT&&(X=i.R32UI),z===i.BYTE&&(X=i.R8I),z===i.SHORT&&(X=i.R16I),z===i.INT&&(X=i.R32I)),v===i.RG&&(z===i.FLOAT&&(X=i.RG32F),z===i.HALF_FLOAT&&(X=i.RG16F),z===i.UNSIGNED_BYTE&&(X=i.RG8)),v===i.RG_INTEGER&&(z===i.UNSIGNED_BYTE&&(X=i.RG8UI),z===i.UNSIGNED_SHORT&&(X=i.RG16UI),z===i.UNSIGNED_INT&&(X=i.RG32UI),z===i.BYTE&&(X=i.RG8I),z===i.SHORT&&(X=i.RG16I),z===i.INT&&(X=i.RG32I)),v===i.RGB_INTEGER&&(z===i.UNSIGNED_BYTE&&(X=i.RGB8UI),z===i.UNSIGNED_SHORT&&(X=i.RGB16UI),z===i.UNSIGNED_INT&&(X=i.RGB32UI),z===i.BYTE&&(X=i.RGB8I),z===i.SHORT&&(X=i.RGB16I),z===i.INT&&(X=i.RGB32I)),v===i.RGBA_INTEGER&&(z===i.UNSIGNED_BYTE&&(X=i.RGBA8UI),z===i.UNSIGNED_SHORT&&(X=i.RGBA16UI),z===i.UNSIGNED_INT&&(X=i.RGBA32UI),z===i.BYTE&&(X=i.RGBA8I),z===i.SHORT&&(X=i.RGBA16I),z===i.INT&&(X=i.RGBA32I)),v===i.RGB&&(z===i.UNSIGNED_INT_5_9_9_9_REV&&(X=i.RGB9_E5),z===i.UNSIGNED_INT_10F_11F_11F_REV&&(X=i.R11F_G11F_B10F)),v===i.RGBA){let Ee=Z?sr:Ke.getTransfer(Y);z===i.FLOAT&&(X=i.RGBA32F),z===i.HALF_FLOAT&&(X=i.RGBA16F),z===i.UNSIGNED_BYTE&&(X=Ee===at?i.SRGB8_ALPHA8:i.RGBA8),z===i.UNSIGNED_SHORT_4_4_4_4&&(X=i.RGBA4),z===i.UNSIGNED_SHORT_5_5_5_1&&(X=i.RGB5_A1)}return(X===i.R16F||X===i.R32F||X===i.RG16F||X===i.RG32F||X===i.RGBA16F||X===i.RGBA32F)&&e.get("EXT_color_buffer_float"),X}function M(R,v){let z;return R?v===null||v===di||v===Cs?z=i.DEPTH24_STENCIL8:v===un?z=i.DEPTH32F_STENCIL8:v===ws&&(z=i.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):v===null||v===di||v===Cs?z=i.DEPTH_COMPONENT24:v===un?z=i.DEPTH_COMPONENT32F:v===ws&&(z=i.DEPTH_COMPONENT16),z}function A(R,v){return m(R)===!0||R.isFramebufferTexture&&R.minFilter!==Pt&&R.minFilter!==Vt?Math.log2(Math.max(v.width,v.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?v.mipmaps.length:1}function E(R){let v=R.target;v.removeEventListener("dispose",E),D(v),v.isVideoTexture&&u.delete(v)}function C(R){let v=R.target;v.removeEventListener("dispose",C),y(v)}function D(R){let v=n.get(R);if(v.__webglInit===void 0)return;let z=R.source,Y=d.get(z);if(Y){let Z=Y[v.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&S(R),Object.keys(Y).length===0&&d.delete(z)}n.remove(R)}function S(R){let v=n.get(R);i.deleteTexture(v.__webglTexture);let z=R.source,Y=d.get(z);delete Y[v.__cacheKey],o.memory.textures--}function y(R){let v=n.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),n.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let Y=0;Y<6;Y++){if(Array.isArray(v.__webglFramebuffer[Y]))for(let Z=0;Z<v.__webglFramebuffer[Y].length;Z++)i.deleteFramebuffer(v.__webglFramebuffer[Y][Z]);else i.deleteFramebuffer(v.__webglFramebuffer[Y]);v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer[Y])}else{if(Array.isArray(v.__webglFramebuffer))for(let Y=0;Y<v.__webglFramebuffer.length;Y++)i.deleteFramebuffer(v.__webglFramebuffer[Y]);else i.deleteFramebuffer(v.__webglFramebuffer);if(v.__webglDepthbuffer&&i.deleteRenderbuffer(v.__webglDepthbuffer),v.__webglMultisampledFramebuffer&&i.deleteFramebuffer(v.__webglMultisampledFramebuffer),v.__webglColorRenderbuffer)for(let Y=0;Y<v.__webglColorRenderbuffer.length;Y++)v.__webglColorRenderbuffer[Y]&&i.deleteRenderbuffer(v.__webglColorRenderbuffer[Y]);v.__webglDepthRenderbuffer&&i.deleteRenderbuffer(v.__webglDepthRenderbuffer)}let z=R.textures;for(let Y=0,Z=z.length;Y<Z;Y++){let X=n.get(z[Y]);X.__webglTexture&&(i.deleteTexture(X.__webglTexture),o.memory.textures--),n.remove(z[Y])}n.remove(R)}let P=0;function F(){P=0}function k(){let R=P;return R>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+R+" texture units while this GPU supports only "+s.maxTextures),P+=1,R}function H(R){let v=[];return v.push(R.wrapS),v.push(R.wrapT),v.push(R.wrapR||0),v.push(R.magFilter),v.push(R.minFilter),v.push(R.anisotropy),v.push(R.internalFormat),v.push(R.format),v.push(R.type),v.push(R.generateMipmaps),v.push(R.premultiplyAlpha),v.push(R.flipY),v.push(R.unpackAlignment),v.push(R.colorSpace),v.join()}function q(R,v){let z=n.get(R);if(R.isVideoTexture&&ze(R),R.isRenderTargetTexture===!1&&R.isExternalTexture!==!0&&R.version>0&&z.__version!==R.version){let Y=R.image;if(Y===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(Y.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{G(z,R,v);return}}else R.isExternalTexture&&(z.__webglTexture=R.sourceTexture?R.sourceTexture:null);t.bindTexture(i.TEXTURE_2D,z.__webglTexture,i.TEXTURE0+v)}function W(R,v){let z=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){G(z,R,v);return}t.bindTexture(i.TEXTURE_2D_ARRAY,z.__webglTexture,i.TEXTURE0+v)}function te(R,v){let z=n.get(R);if(R.isRenderTargetTexture===!1&&R.version>0&&z.__version!==R.version){G(z,R,v);return}t.bindTexture(i.TEXTURE_3D,z.__webglTexture,i.TEXTURE0+v)}function V(R,v){let z=n.get(R);if(R.version>0&&z.__version!==R.version){K(z,R,v);return}t.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture,i.TEXTURE0+v)}let oe={[oi]:i.REPEAT,[En]:i.CLAMP_TO_EDGE,[ps]:i.MIRRORED_REPEAT},ce={[Pt]:i.NEAREST,[ca]:i.NEAREST_MIPMAP_NEAREST,[Fi]:i.NEAREST_MIPMAP_LINEAR,[Vt]:i.LINEAR,[As]:i.LINEAR_MIPMAP_NEAREST,[Sn]:i.LINEAR_MIPMAP_LINEAR},Te={[xd]:i.NEVER,[Td]:i.ALWAYS,[yd]:i.LESS,[Ec]:i.LEQUAL,[vd]:i.EQUAL,[bd]:i.GEQUAL,[Sd]:i.GREATER,[Md]:i.NOTEQUAL};function re(R,v){if(v.type===un&&e.has("OES_texture_float_linear")===!1&&(v.magFilter===Vt||v.magFilter===As||v.magFilter===Fi||v.magFilter===Sn||v.minFilter===Vt||v.minFilter===As||v.minFilter===Fi||v.minFilter===Sn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),i.texParameteri(R,i.TEXTURE_WRAP_S,oe[v.wrapS]),i.texParameteri(R,i.TEXTURE_WRAP_T,oe[v.wrapT]),(R===i.TEXTURE_3D||R===i.TEXTURE_2D_ARRAY)&&i.texParameteri(R,i.TEXTURE_WRAP_R,oe[v.wrapR]),i.texParameteri(R,i.TEXTURE_MAG_FILTER,ce[v.magFilter]),i.texParameteri(R,i.TEXTURE_MIN_FILTER,ce[v.minFilter]),v.compareFunction&&(i.texParameteri(R,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(R,i.TEXTURE_COMPARE_FUNC,Te[v.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(v.magFilter===Pt||v.minFilter!==Fi&&v.minFilter!==Sn||v.type===un&&e.has("OES_texture_float_linear")===!1)return;if(v.anisotropy>1||n.get(v).__currentAnisotropy){let z=e.get("EXT_texture_filter_anisotropic");i.texParameterf(R,z.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(v.anisotropy,s.getMaxAnisotropy())),n.get(v).__currentAnisotropy=v.anisotropy}}}function ae(R,v){let z=!1;R.__webglInit===void 0&&(R.__webglInit=!0,v.addEventListener("dispose",E));let Y=v.source,Z=d.get(Y);Z===void 0&&(Z={},d.set(Y,Z));let X=H(v);if(X!==R.__cacheKey){Z[X]===void 0&&(Z[X]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,z=!0),Z[X].usedTimes++;let Ee=Z[R.__cacheKey];Ee!==void 0&&(Z[R.__cacheKey].usedTimes--,Ee.usedTimes===0&&S(v)),R.__cacheKey=X,R.__webglTexture=Z[X].texture}return z}function Oe(R,v,z){return Math.floor(Math.floor(R/z)/v)}function Re(R,v,z,Y){let X=R.updateRanges;if(X.length===0)t.texSubImage2D(i.TEXTURE_2D,0,0,0,v.width,v.height,z,Y,v.data);else{X.sort((Q,ue)=>Q.start-ue.start);let Ee=0;for(let Q=1;Q<X.length;Q++){let ue=X[Ee],Ne=X[Q],ve=ue.start+ue.count,le=Oe(Ne.start,v.width,4),ke=Oe(ue.start,v.width,4);Ne.start<=ve+1&&le===ke&&Oe(Ne.start+Ne.count-1,v.width,4)===le?ue.count=Math.max(ue.count,Ne.start+Ne.count-ue.start):(++Ee,X[Ee]=Ne)}X.length=Ee+1;let J=i.getParameter(i.UNPACK_ROW_LENGTH),ge=i.getParameter(i.UNPACK_SKIP_PIXELS),Se=i.getParameter(i.UNPACK_SKIP_ROWS);i.pixelStorei(i.UNPACK_ROW_LENGTH,v.width);for(let Q=0,ue=X.length;Q<ue;Q++){let Ne=X[Q],ve=Math.floor(Ne.start/4),le=Math.ceil(Ne.count/4),ke=ve%v.width,O=Math.floor(ve/v.width),ne=le,se=1;i.pixelStorei(i.UNPACK_SKIP_PIXELS,ke),i.pixelStorei(i.UNPACK_SKIP_ROWS,O),t.texSubImage2D(i.TEXTURE_2D,0,ke,O,ne,se,z,Y,v.data)}R.clearUpdateRanges(),i.pixelStorei(i.UNPACK_ROW_LENGTH,J),i.pixelStorei(i.UNPACK_SKIP_PIXELS,ge),i.pixelStorei(i.UNPACK_SKIP_ROWS,Se)}}function G(R,v,z){let Y=i.TEXTURE_2D;(v.isDataArrayTexture||v.isCompressedArrayTexture)&&(Y=i.TEXTURE_2D_ARRAY),v.isData3DTexture&&(Y=i.TEXTURE_3D);let Z=ae(R,v),X=v.source;t.bindTexture(Y,R.__webglTexture,i.TEXTURE0+z);let Ee=n.get(X);if(X.version!==Ee.__version||Z===!0){t.activeTexture(i.TEXTURE0+z);let J=Ke.getPrimaries(Ke.workingColorSpace),ge=v.colorSpace===Jn?null:Ke.getPrimaries(v.colorSpace),Se=v.colorSpace===Jn||J===ge?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Se);let Q=x(v.image,!1,s.maxTextureSize);Q=mt(v,Q);let ue=r.convert(v.format,v.colorSpace),Ne=r.convert(v.type),ve=b(v.internalFormat,ue,Ne,v.colorSpace,v.isVideoTexture);re(Y,v);let le,ke=v.mipmaps,O=v.isVideoTexture!==!0,ne=Ee.__version===void 0||Z===!0,se=X.dataReady,fe=A(v,Q);if(v.isDepthTexture)ve=M(v.format===Is,v.type),ne&&(O?t.texStorage2D(i.TEXTURE_2D,1,ve,Q.width,Q.height):t.texImage2D(i.TEXTURE_2D,0,ve,Q.width,Q.height,0,ue,Ne,null));else if(v.isDataTexture)if(ke.length>0){O&&ne&&t.texStorage2D(i.TEXTURE_2D,fe,ve,ke[0].width,ke[0].height);for(let ee=0,$=ke.length;ee<$;ee++)le=ke[ee],O?se&&t.texSubImage2D(i.TEXTURE_2D,ee,0,0,le.width,le.height,ue,Ne,le.data):t.texImage2D(i.TEXTURE_2D,ee,ve,le.width,le.height,0,ue,Ne,le.data);v.generateMipmaps=!1}else O?(ne&&t.texStorage2D(i.TEXTURE_2D,fe,ve,Q.width,Q.height),se&&Re(v,Q,ue,Ne)):t.texImage2D(i.TEXTURE_2D,0,ve,Q.width,Q.height,0,ue,Ne,Q.data);else if(v.isCompressedTexture)if(v.isCompressedArrayTexture){O&&ne&&t.texStorage3D(i.TEXTURE_2D_ARRAY,fe,ve,ke[0].width,ke[0].height,Q.depth);for(let ee=0,$=ke.length;ee<$;ee++)if(le=ke[ee],v.format!==tn)if(ue!==null)if(O){if(se)if(v.layerUpdates.size>0){let Me=Lc(le.width,le.height,v.format,v.type);for(let Fe of v.layerUpdates){let st=le.data.subarray(Fe*Me/le.data.BYTES_PER_ELEMENT,(Fe+1)*Me/le.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ee,0,0,Fe,le.width,le.height,1,ue,st)}v.clearLayerUpdates()}else t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ee,0,0,0,le.width,le.height,Q.depth,ue,le.data)}else t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,ee,ve,le.width,le.height,Q.depth,0,le.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else O?se&&t.texSubImage3D(i.TEXTURE_2D_ARRAY,ee,0,0,0,le.width,le.height,Q.depth,ue,Ne,le.data):t.texImage3D(i.TEXTURE_2D_ARRAY,ee,ve,le.width,le.height,Q.depth,0,ue,Ne,le.data)}else{O&&ne&&t.texStorage2D(i.TEXTURE_2D,fe,ve,ke[0].width,ke[0].height);for(let ee=0,$=ke.length;ee<$;ee++)le=ke[ee],v.format!==tn?ue!==null?O?se&&t.compressedTexSubImage2D(i.TEXTURE_2D,ee,0,0,le.width,le.height,ue,le.data):t.compressedTexImage2D(i.TEXTURE_2D,ee,ve,le.width,le.height,0,le.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):O?se&&t.texSubImage2D(i.TEXTURE_2D,ee,0,0,le.width,le.height,ue,Ne,le.data):t.texImage2D(i.TEXTURE_2D,ee,ve,le.width,le.height,0,ue,Ne,le.data)}else if(v.isDataArrayTexture)if(O){if(ne&&t.texStorage3D(i.TEXTURE_2D_ARRAY,fe,ve,Q.width,Q.height,Q.depth),se)if(v.layerUpdates.size>0){let ee=Lc(Q.width,Q.height,v.format,v.type);for(let $ of v.layerUpdates){let Me=Q.data.subarray($*ee/Q.data.BYTES_PER_ELEMENT,($+1)*ee/Q.data.BYTES_PER_ELEMENT);t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,$,Q.width,Q.height,1,ue,Ne,Me)}v.clearLayerUpdates()}else t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,ue,Ne,Q.data)}else t.texImage3D(i.TEXTURE_2D_ARRAY,0,ve,Q.width,Q.height,Q.depth,0,ue,Ne,Q.data);else if(v.isData3DTexture)O?(ne&&t.texStorage3D(i.TEXTURE_3D,fe,ve,Q.width,Q.height,Q.depth),se&&t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,ue,Ne,Q.data)):t.texImage3D(i.TEXTURE_3D,0,ve,Q.width,Q.height,Q.depth,0,ue,Ne,Q.data);else if(v.isFramebufferTexture){if(ne)if(O)t.texStorage2D(i.TEXTURE_2D,fe,ve,Q.width,Q.height);else{let ee=Q.width,$=Q.height;for(let Me=0;Me<fe;Me++)t.texImage2D(i.TEXTURE_2D,Me,ve,ee,$,0,ue,Ne,null),ee>>=1,$>>=1}}else if(ke.length>0){if(O&&ne){let ee=Ze(ke[0]);t.texStorage2D(i.TEXTURE_2D,fe,ve,ee.width,ee.height)}for(let ee=0,$=ke.length;ee<$;ee++)le=ke[ee],O?se&&t.texSubImage2D(i.TEXTURE_2D,ee,0,0,ue,Ne,le):t.texImage2D(i.TEXTURE_2D,ee,ve,ue,Ne,le);v.generateMipmaps=!1}else if(O){if(ne){let ee=Ze(Q);t.texStorage2D(i.TEXTURE_2D,fe,ve,ee.width,ee.height)}se&&t.texSubImage2D(i.TEXTURE_2D,0,0,0,ue,Ne,Q)}else t.texImage2D(i.TEXTURE_2D,0,ve,ue,Ne,Q);m(v)&&f(Y),Ee.__version=X.version,v.onUpdate&&v.onUpdate(v)}R.__version=v.version}function K(R,v,z){if(v.image.length!==6)return;let Y=ae(R,v),Z=v.source;t.bindTexture(i.TEXTURE_CUBE_MAP,R.__webglTexture,i.TEXTURE0+z);let X=n.get(Z);if(Z.version!==X.__version||Y===!0){t.activeTexture(i.TEXTURE0+z);let Ee=Ke.getPrimaries(Ke.workingColorSpace),J=v.colorSpace===Jn?null:Ke.getPrimaries(v.colorSpace),ge=v.colorSpace===Jn||Ee===J?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,v.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,v.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,v.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,ge);let Se=v.isCompressedTexture||v.image[0].isCompressedTexture,Q=v.image[0]&&v.image[0].isDataTexture,ue=[];for(let $=0;$<6;$++)!Se&&!Q?ue[$]=x(v.image[$],!0,s.maxCubemapSize):ue[$]=Q?v.image[$].image:v.image[$],ue[$]=mt(v,ue[$]);let Ne=ue[0],ve=r.convert(v.format,v.colorSpace),le=r.convert(v.type),ke=b(v.internalFormat,ve,le,v.colorSpace),O=v.isVideoTexture!==!0,ne=X.__version===void 0||Y===!0,se=Z.dataReady,fe=A(v,Ne);re(i.TEXTURE_CUBE_MAP,v);let ee;if(Se){O&&ne&&t.texStorage2D(i.TEXTURE_CUBE_MAP,fe,ke,Ne.width,Ne.height);for(let $=0;$<6;$++){ee=ue[$].mipmaps;for(let Me=0;Me<ee.length;Me++){let Fe=ee[Me];v.format!==tn?ve!==null?O?se&&t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me,0,0,Fe.width,Fe.height,ve,Fe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me,ke,Fe.width,Fe.height,0,Fe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):O?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me,0,0,Fe.width,Fe.height,ve,le,Fe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me,ke,Fe.width,Fe.height,0,ve,le,Fe.data)}}}else{if(ee=v.mipmaps,O&&ne){ee.length>0&&fe++;let $=Ze(ue[0]);t.texStorage2D(i.TEXTURE_CUBE_MAP,fe,ke,$.width,$.height)}for(let $=0;$<6;$++)if(Q){O?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,0,0,0,ue[$].width,ue[$].height,ve,le,ue[$].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,0,ke,ue[$].width,ue[$].height,0,ve,le,ue[$].data);for(let Me=0;Me<ee.length;Me++){let st=ee[Me].image[$].image;O?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me+1,0,0,st.width,st.height,ve,le,st.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me+1,ke,st.width,st.height,0,ve,le,st.data)}}else{O?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,0,0,0,ve,le,ue[$]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,0,ke,ve,le,ue[$]);for(let Me=0;Me<ee.length;Me++){let Fe=ee[Me];O?se&&t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me+1,0,0,ve,le,Fe.image[$]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+$,Me+1,ke,ve,le,Fe.image[$])}}}m(v)&&f(i.TEXTURE_CUBE_MAP),X.__version=Z.version,v.onUpdate&&v.onUpdate(v)}R.__version=v.version}function de(R,v,z,Y,Z,X){let Ee=r.convert(z.format,z.colorSpace),J=r.convert(z.type),ge=b(z.internalFormat,Ee,J,z.colorSpace),Se=n.get(v),Q=n.get(z);if(Q.__renderTarget=v,!Se.__hasExternalTextures){let ue=Math.max(1,v.width>>X),Ne=Math.max(1,v.height>>X);Z===i.TEXTURE_3D||Z===i.TEXTURE_2D_ARRAY?t.texImage3D(Z,X,ge,ue,Ne,v.depth,0,Ee,J,null):t.texImage2D(Z,X,ge,ue,Ne,0,Ee,J,null)}t.bindFramebuffer(i.FRAMEBUFFER,R),xe(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,Y,Z,Q.__webglTexture,0,dt(v)):(Z===i.TEXTURE_2D||Z>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,Y,Z,Q.__webglTexture,X),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ce(R,v,z){if(i.bindRenderbuffer(i.RENDERBUFFER,R),v.depthBuffer){let Y=v.depthTexture,Z=Y&&Y.isDepthTexture?Y.type:null,X=M(v.stencilBuffer,Z),Ee=v.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,J=dt(v);xe(v)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,J,X,v.width,v.height):z?i.renderbufferStorageMultisample(i.RENDERBUFFER,J,X,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,X,v.width,v.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,Ee,i.RENDERBUFFER,R)}else{let Y=v.textures;for(let Z=0;Z<Y.length;Z++){let X=Y[Z],Ee=r.convert(X.format,X.colorSpace),J=r.convert(X.type),ge=b(X.internalFormat,Ee,J,X.colorSpace),Se=dt(v);z&&xe(v)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Se,ge,v.width,v.height):xe(v)?a.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Se,ge,v.width,v.height):i.renderbufferStorage(i.RENDERBUFFER,ge,v.width,v.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function _e(R,v){if(v&&v.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,R),!(v.depthTexture&&v.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");let Y=n.get(v.depthTexture);Y.__renderTarget=v,(!Y.__webglTexture||v.depthTexture.image.width!==v.width||v.depthTexture.image.height!==v.height)&&(v.depthTexture.image.width=v.width,v.depthTexture.image.height=v.height,v.depthTexture.needsUpdate=!0),q(v.depthTexture,0);let Z=Y.__webglTexture,X=dt(v);if(v.depthTexture.format===ms)xe(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Z,0,X):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,Z,0);else if(v.depthTexture.format===Is)xe(v)?a.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Z,0,X):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,Z,0);else throw new Error("Unknown depthTexture format")}function He(R){let v=n.get(R),z=R.isWebGLCubeRenderTarget===!0;if(v.__boundDepthTexture!==R.depthTexture){let Y=R.depthTexture;if(v.__depthDisposeCallback&&v.__depthDisposeCallback(),Y){let Z=()=>{delete v.__boundDepthTexture,delete v.__depthDisposeCallback,Y.removeEventListener("dispose",Z)};Y.addEventListener("dispose",Z),v.__depthDisposeCallback=Z}v.__boundDepthTexture=Y}if(R.depthTexture&&!v.__autoAllocateDepthBuffer){if(z)throw new Error("target.depthTexture not supported in Cube render targets");let Y=R.texture.mipmaps;Y&&Y.length>0?_e(v.__webglFramebuffer[0],R):_e(v.__webglFramebuffer,R)}else if(z){v.__webglDepthbuffer=[];for(let Y=0;Y<6;Y++)if(t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[Y]),v.__webglDepthbuffer[Y]===void 0)v.__webglDepthbuffer[Y]=i.createRenderbuffer(),Ce(v.__webglDepthbuffer[Y],R,!1);else{let Z=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,X=v.__webglDepthbuffer[Y];i.bindRenderbuffer(i.RENDERBUFFER,X),i.framebufferRenderbuffer(i.FRAMEBUFFER,Z,i.RENDERBUFFER,X)}}else{let Y=R.texture.mipmaps;if(Y&&Y.length>0?t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer[0]):t.bindFramebuffer(i.FRAMEBUFFER,v.__webglFramebuffer),v.__webglDepthbuffer===void 0)v.__webglDepthbuffer=i.createRenderbuffer(),Ce(v.__webglDepthbuffer,R,!1);else{let Z=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,X=v.__webglDepthbuffer;i.bindRenderbuffer(i.RENDERBUFFER,X),i.framebufferRenderbuffer(i.FRAMEBUFFER,Z,i.RENDERBUFFER,X)}}t.bindFramebuffer(i.FRAMEBUFFER,null)}function pt(R,v,z){let Y=n.get(R);v!==void 0&&de(Y.__webglFramebuffer,R,R.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),z!==void 0&&He(R)}function I(R){let v=R.texture,z=n.get(R),Y=n.get(v);R.addEventListener("dispose",C);let Z=R.textures,X=R.isWebGLCubeRenderTarget===!0,Ee=Z.length>1;if(Ee||(Y.__webglTexture===void 0&&(Y.__webglTexture=i.createTexture()),Y.__version=v.version,o.memory.textures++),X){z.__webglFramebuffer=[];for(let J=0;J<6;J++)if(v.mipmaps&&v.mipmaps.length>0){z.__webglFramebuffer[J]=[];for(let ge=0;ge<v.mipmaps.length;ge++)z.__webglFramebuffer[J][ge]=i.createFramebuffer()}else z.__webglFramebuffer[J]=i.createFramebuffer()}else{if(v.mipmaps&&v.mipmaps.length>0){z.__webglFramebuffer=[];for(let J=0;J<v.mipmaps.length;J++)z.__webglFramebuffer[J]=i.createFramebuffer()}else z.__webglFramebuffer=i.createFramebuffer();if(Ee)for(let J=0,ge=Z.length;J<ge;J++){let Se=n.get(Z[J]);Se.__webglTexture===void 0&&(Se.__webglTexture=i.createTexture(),o.memory.textures++)}if(R.samples>0&&xe(R)===!1){z.__webglMultisampledFramebuffer=i.createFramebuffer(),z.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let J=0;J<Z.length;J++){let ge=Z[J];z.__webglColorRenderbuffer[J]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,z.__webglColorRenderbuffer[J]);let Se=r.convert(ge.format,ge.colorSpace),Q=r.convert(ge.type),ue=b(ge.internalFormat,Se,Q,ge.colorSpace,R.isXRRenderTarget===!0),Ne=dt(R);i.renderbufferStorageMultisample(i.RENDERBUFFER,Ne,ue,R.width,R.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+J,i.RENDERBUFFER,z.__webglColorRenderbuffer[J])}i.bindRenderbuffer(i.RENDERBUFFER,null),R.depthBuffer&&(z.__webglDepthRenderbuffer=i.createRenderbuffer(),Ce(z.__webglDepthRenderbuffer,R,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(X){t.bindTexture(i.TEXTURE_CUBE_MAP,Y.__webglTexture),re(i.TEXTURE_CUBE_MAP,v);for(let J=0;J<6;J++)if(v.mipmaps&&v.mipmaps.length>0)for(let ge=0;ge<v.mipmaps.length;ge++)de(z.__webglFramebuffer[J][ge],R,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+J,ge);else de(z.__webglFramebuffer[J],R,v,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+J,0);m(v)&&f(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Ee){for(let J=0,ge=Z.length;J<ge;J++){let Se=Z[J],Q=n.get(Se),ue=i.TEXTURE_2D;(R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(ue=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(ue,Q.__webglTexture),re(ue,Se),de(z.__webglFramebuffer,R,Se,i.COLOR_ATTACHMENT0+J,ue,0),m(Se)&&f(ue)}t.unbindTexture()}else{let J=i.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(J=R.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY),t.bindTexture(J,Y.__webglTexture),re(J,v),v.mipmaps&&v.mipmaps.length>0)for(let ge=0;ge<v.mipmaps.length;ge++)de(z.__webglFramebuffer[ge],R,v,i.COLOR_ATTACHMENT0,J,ge);else de(z.__webglFramebuffer,R,v,i.COLOR_ATTACHMENT0,J,0);m(v)&&f(J),t.unbindTexture()}R.depthBuffer&&He(R)}function et(R){let v=R.textures;for(let z=0,Y=v.length;z<Y;z++){let Z=v[z];if(m(Z)){let X=T(R),Ee=n.get(Z).__webglTexture;t.bindTexture(X,Ee),f(X),t.unbindTexture()}}}let Ue=[],Le=[];function ye(R){if(R.samples>0){if(xe(R)===!1){let v=R.textures,z=R.width,Y=R.height,Z=i.COLOR_BUFFER_BIT,X=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,Ee=n.get(R),J=v.length>1;if(J)for(let Se=0;Se<v.length;Se++)t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Se,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Se,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer);let ge=R.texture.mipmaps;ge&&ge.length>0?t.bindFramebuffer(i.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer[0]):t.bindFramebuffer(i.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer);for(let Se=0;Se<v.length;Se++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(Z|=i.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(Z|=i.STENCIL_BUFFER_BIT)),J){i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,Ee.__webglColorRenderbuffer[Se]);let Q=n.get(v[Se]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Q,0)}i.blitFramebuffer(0,0,z,Y,0,0,z,Y,Z,i.NEAREST),c===!0&&(Ue.length=0,Le.length=0,Ue.push(i.COLOR_ATTACHMENT0+Se),R.depthBuffer&&R.resolveDepthBuffer===!1&&(Ue.push(X),Le.push(X),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,Le)),i.invalidateFramebuffer(i.READ_FRAMEBUFFER,Ue))}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),J)for(let Se=0;Se<v.length;Se++){t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Se,i.RENDERBUFFER,Ee.__webglColorRenderbuffer[Se]);let Q=n.get(v[Se]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,Ee.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Se,i.TEXTURE_2D,Q,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.resolveDepthBuffer===!1&&c){let v=R.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT;i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[v])}}}function dt(R){return Math.min(s.maxSamples,R.samples)}function xe(R){let v=n.get(R);return R.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&v.__useRenderToTexture!==!1}function ze(R){let v=o.render.frame;u.get(R)!==v&&(u.set(R,v),R.update())}function mt(R,v){let z=R.colorSpace,Y=R.format,Z=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||z!==Lt&&z!==Jn&&(Ke.getTransfer(z)===at?(Y!==tn||Z!==Mn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",z)),v}function Ze(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(l.width=R.naturalWidth||R.width,l.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(l.width=R.displayWidth,l.height=R.displayHeight):(l.width=R.width,l.height=R.height),l}this.allocateTextureUnit=k,this.resetTextureUnits=F,this.setTexture2D=q,this.setTexture2DArray=W,this.setTexture3D=te,this.setTextureCube=V,this.rebindTextures=pt,this.setupRenderTarget=I,this.updateRenderTargetMipmap=et,this.updateMultisampleRenderTarget=ye,this.setupDepthRenderbuffer=He,this.setupFrameBufferTexture=de,this.useMultisampledRTT=xe}function Ty(i,e){function t(n,s=Jn){let r,o=Ke.getTransfer(s);if(n===Mn)return i.UNSIGNED_BYTE;if(n===ha)return i.UNSIGNED_SHORT_4_4_4_4;if(n===da)return i.UNSIGNED_SHORT_5_5_5_1;if(n===yc)return i.UNSIGNED_INT_5_9_9_9_REV;if(n===vc)return i.UNSIGNED_INT_10F_11F_11F_REV;if(n===_c)return i.BYTE;if(n===xc)return i.SHORT;if(n===ws)return i.UNSIGNED_SHORT;if(n===ua)return i.INT;if(n===di)return i.UNSIGNED_INT;if(n===un)return i.FLOAT;if(n===Rs)return i.HALF_FLOAT;if(n===Sc)return i.ALPHA;if(n===Mc)return i.RGB;if(n===tn)return i.RGBA;if(n===ms)return i.DEPTH_COMPONENT;if(n===Is)return i.DEPTH_STENCIL;if(n===fa)return i.RED;if(n===pa)return i.RED_INTEGER;if(n===bc)return i.RG;if(n===ma)return i.RG_INTEGER;if(n===ga)return i.RGBA_INTEGER;if(n===Ur||n===Fr||n===Br||n===zr)if(o===at)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ur)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Fr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Br)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===zr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ur)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Fr)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Br)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===zr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===_a||n===xa||n===ya||n===va)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===_a)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===xa)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===ya)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===va)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Sa||n===Ma||n===ba)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Sa||n===Ma)return o===at?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ba)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===Ta||n===Ea||n===Aa||n===wa||n===Ra||n===Ca||n===Ia||n===Pa||n===La||n===Da||n===Na||n===Oa||n===Ua||n===Fa)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===Ta)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Ea)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Aa)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===wa)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===Ra)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Ca)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Ia)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Pa)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===La)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Da)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Na)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Oa)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Ua)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Fa)return o===at?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Ba||n===za||n===ka)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===Ba)return o===at?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===za)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===ka)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Ha||n===Va||n===Ga||n===Wa)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===Ha)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Va)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Ga)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Wa)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Cs?i.UNSIGNED_INT_24_8:i[n]!==void 0?i[n]:null}return{convert:t}}var Ey=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Ay=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,Xc=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new vr(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new yn({vertexShader:Ey,fragmentShader:Ay,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Qe(new Mr(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},Yc=class extends wn{constructor(e,t){super();let n=this,s=null,r=1,o=null,a="local-floor",c=1,l=null,u=null,h=null,d=null,p=null,g=null,x=typeof XRWebGLBinding<"u",m=new Xc,f={},T=t.getContextAttributes(),b=null,M=null,A=[],E=[],C=new we,D=null,S=new vt;S.viewport=new Je;let y=new vt;y.viewport=new Je;let P=[S,y],F=new Zo,k=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(G){let K=A[G];return K===void 0&&(K=new ys,A[G]=K),K.getTargetRaySpace()},this.getControllerGrip=function(G){let K=A[G];return K===void 0&&(K=new ys,A[G]=K),K.getGripSpace()},this.getHand=function(G){let K=A[G];return K===void 0&&(K=new ys,A[G]=K),K.getHandSpace()};function q(G){let K=E.indexOf(G.inputSource);if(K===-1)return;let de=A[K];de!==void 0&&(de.update(G.inputSource,G.frame,l||o),de.dispatchEvent({type:G.type,data:G.inputSource}))}function W(){s.removeEventListener("select",q),s.removeEventListener("selectstart",q),s.removeEventListener("selectend",q),s.removeEventListener("squeeze",q),s.removeEventListener("squeezestart",q),s.removeEventListener("squeezeend",q),s.removeEventListener("end",W),s.removeEventListener("inputsourceschange",te);for(let G=0;G<A.length;G++){let K=E[G];K!==null&&(E[G]=null,A[G].disconnect(K))}k=null,H=null,m.reset();for(let G in f)delete f[G];e.setRenderTarget(b),p=null,d=null,h=null,s=null,M=null,Re.stop(),n.isPresenting=!1,e.setPixelRatio(D),e.setSize(C.width,C.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(G){r=G,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(G){a=G,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function(G){l=G},this.getBaseLayer=function(){return d!==null?d:p},this.getBinding=function(){return h===null&&x&&(h=new XRWebGLBinding(s,t)),h},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(G){if(s=G,s!==null){if(b=e.getRenderTarget(),s.addEventListener("select",q),s.addEventListener("selectstart",q),s.addEventListener("selectend",q),s.addEventListener("squeeze",q),s.addEventListener("squeezestart",q),s.addEventListener("squeezeend",q),s.addEventListener("end",W),s.addEventListener("inputsourceschange",te),T.xrCompatible!==!0&&await t.makeXRCompatible(),D=e.getPixelRatio(),e.getSize(C),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let de=null,Ce=null,_e=null;T.depth&&(_e=T.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,de=T.stencil?Is:ms,Ce=T.stencil?Cs:di);let He={colorFormat:t.RGBA8,depthFormat:_e,scaleFactor:r};h=this.getBinding(),d=h.createProjectionLayer(He),s.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),M=new Rn(d.textureWidth,d.textureHeight,{format:tn,type:Mn,depthTexture:new yr(d.textureWidth,d.textureHeight,Ce,void 0,void 0,void 0,void 0,void 0,void 0,de),stencilBuffer:T.stencil,colorSpace:e.outputColorSpace,samples:T.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{let de={antialias:T.antialias,alpha:!0,depth:T.depth,stencil:T.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(s,t,de),s.updateRenderState({baseLayer:p}),e.setPixelRatio(1),e.setSize(p.framebufferWidth,p.framebufferHeight,!1),M=new Rn(p.framebufferWidth,p.framebufferHeight,{format:tn,type:Mn,colorSpace:e.outputColorSpace,stencilBuffer:T.stencil,resolveDepthBuffer:p.ignoreDepthValues===!1,resolveStencilBuffer:p.ignoreDepthValues===!1})}M.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await s.requestReferenceSpace(a),Re.setContext(s),Re.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function te(G){for(let K=0;K<G.removed.length;K++){let de=G.removed[K],Ce=E.indexOf(de);Ce>=0&&(E[Ce]=null,A[Ce].disconnect(de))}for(let K=0;K<G.added.length;K++){let de=G.added[K],Ce=E.indexOf(de);if(Ce===-1){for(let He=0;He<A.length;He++)if(He>=E.length){E.push(de),Ce=He;break}else if(E[He]===null){E[He]=de,Ce=He;break}if(Ce===-1)break}let _e=A[Ce];_e&&_e.connect(de)}}let V=new L,oe=new L;function ce(G,K,de){V.setFromMatrixPosition(K.matrixWorld),oe.setFromMatrixPosition(de.matrixWorld);let Ce=V.distanceTo(oe),_e=K.projectionMatrix.elements,He=de.projectionMatrix.elements,pt=_e[14]/(_e[10]-1),I=_e[14]/(_e[10]+1),et=(_e[9]+1)/_e[5],Ue=(_e[9]-1)/_e[5],Le=(_e[8]-1)/_e[0],ye=(He[8]+1)/He[0],dt=pt*Le,xe=pt*ye,ze=Ce/(-Le+ye),mt=ze*-Le;if(K.matrixWorld.decompose(G.position,G.quaternion,G.scale),G.translateX(mt),G.translateZ(ze),G.matrixWorld.compose(G.position,G.quaternion,G.scale),G.matrixWorldInverse.copy(G.matrixWorld).invert(),_e[10]===-1)G.projectionMatrix.copy(K.projectionMatrix),G.projectionMatrixInverse.copy(K.projectionMatrixInverse);else{let Ze=pt+ze,R=I+ze,v=dt-mt,z=xe+(Ce-mt),Y=et*I/R*Ze,Z=Ue*I/R*Ze;G.projectionMatrix.makePerspective(v,z,Y,Z,Ze,R),G.projectionMatrixInverse.copy(G.projectionMatrix).invert()}}function Te(G,K){K===null?G.matrixWorld.copy(G.matrix):G.matrixWorld.multiplyMatrices(K.matrixWorld,G.matrix),G.matrixWorldInverse.copy(G.matrixWorld).invert()}this.updateCamera=function(G){if(s===null)return;let K=G.near,de=G.far;m.texture!==null&&(m.depthNear>0&&(K=m.depthNear),m.depthFar>0&&(de=m.depthFar)),F.near=y.near=S.near=K,F.far=y.far=S.far=de,(k!==F.near||H!==F.far)&&(s.updateRenderState({depthNear:F.near,depthFar:F.far}),k=F.near,H=F.far),F.layers.mask=G.layers.mask|6,S.layers.mask=F.layers.mask&3,y.layers.mask=F.layers.mask&5;let Ce=G.parent,_e=F.cameras;Te(F,Ce);for(let He=0;He<_e.length;He++)Te(_e[He],Ce);_e.length===2?ce(F,S,y):F.projectionMatrix.copy(S.projectionMatrix),re(G,F,Ce)};function re(G,K,de){de===null?G.matrix.copy(K.matrixWorld):(G.matrix.copy(de.matrixWorld),G.matrix.invert(),G.matrix.multiply(K.matrixWorld)),G.matrix.decompose(G.position,G.quaternion,G.scale),G.updateMatrixWorld(!0),G.projectionMatrix.copy(K.projectionMatrix),G.projectionMatrixInverse.copy(K.projectionMatrixInverse),G.isPerspectiveCamera&&(G.fov=Ei*2*Math.atan(1/G.projectionMatrix.elements[5]),G.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(d===null&&p===null))return c},this.setFoveation=function(G){c=G,d!==null&&(d.fixedFoveation=G),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=G)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(G){return f[G]};let ae=null;function Oe(G,K){if(u=K.getViewerPose(l||o),g=K,u!==null){let de=u.views;p!==null&&(e.setRenderTargetFramebuffer(M,p.framebuffer),e.setRenderTarget(M));let Ce=!1;de.length!==F.cameras.length&&(F.cameras.length=0,Ce=!0);for(let I=0;I<de.length;I++){let et=de[I],Ue=null;if(p!==null)Ue=p.getViewport(et);else{let ye=h.getViewSubImage(d,et);Ue=ye.viewport,I===0&&(e.setRenderTargetTextures(M,ye.colorTexture,ye.depthStencilTexture),e.setRenderTarget(M))}let Le=P[I];Le===void 0&&(Le=new vt,Le.layers.enable(I),Le.viewport=new Je,P[I]=Le),Le.matrix.fromArray(et.transform.matrix),Le.matrix.decompose(Le.position,Le.quaternion,Le.scale),Le.projectionMatrix.fromArray(et.projectionMatrix),Le.projectionMatrixInverse.copy(Le.projectionMatrix).invert(),Le.viewport.set(Ue.x,Ue.y,Ue.width,Ue.height),I===0&&(F.matrix.copy(Le.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),Ce===!0&&F.cameras.push(Le)}let _e=s.enabledFeatures;if(_e&&_e.includes("depth-sensing")&&s.depthUsage=="gpu-optimized"&&x){h=n.getBinding();let I=h.getDepthInformation(de[0]);I&&I.isValid&&I.texture&&m.init(I,s.renderState)}if(_e&&_e.includes("camera-access")&&x){e.state.unbindTexture(),h=n.getBinding();for(let I=0;I<de.length;I++){let et=de[I].camera;if(et){let Ue=f[et];Ue||(Ue=new vr,f[et]=Ue);let Le=h.getCameraImage(et);Ue.sourceTexture=Le}}}}for(let de=0;de<A.length;de++){let Ce=E[de],_e=A[de];Ce!==null&&_e!==void 0&&_e.update(Ce,K,l||o)}ae&&ae(G,K),K.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:K}),g=null}let Re=new tf;Re.setAnimationLoop(Oe),this.setAnimationLoop=function(G){ae=G},this.dispose=function(){}}},ki=new cn,wy=new Ve;function Ry(i,e){function t(m,f){m.matrixAutoUpdate===!0&&m.updateMatrix(),f.value.copy(m.matrix)}function n(m,f){f.color.getRGB(m.fogColor.value,Cc(i)),f.isFog?(m.fogNear.value=f.near,m.fogFar.value=f.far):f.isFogExp2&&(m.fogDensity.value=f.density)}function s(m,f,T,b,M){f.isMeshBasicMaterial||f.isMeshLambertMaterial?r(m,f):f.isMeshToonMaterial?(r(m,f),h(m,f)):f.isMeshPhongMaterial?(r(m,f),u(m,f)):f.isMeshStandardMaterial?(r(m,f),d(m,f),f.isMeshPhysicalMaterial&&p(m,f,M)):f.isMeshMatcapMaterial?(r(m,f),g(m,f)):f.isMeshDepthMaterial?r(m,f):f.isMeshDistanceMaterial?(r(m,f),x(m,f)):f.isMeshNormalMaterial?r(m,f):f.isLineBasicMaterial?(o(m,f),f.isLineDashedMaterial&&a(m,f)):f.isPointsMaterial?c(m,f,T,b):f.isSpriteMaterial?l(m,f):f.isShadowMaterial?(m.color.value.copy(f.color),m.opacity.value=f.opacity):f.isShaderMaterial&&(f.uniformsNeedUpdate=!1)}function r(m,f){m.opacity.value=f.opacity,f.color&&m.diffuse.value.copy(f.color),f.emissive&&m.emissive.value.copy(f.emissive).multiplyScalar(f.emissiveIntensity),f.map&&(m.map.value=f.map,t(f.map,m.mapTransform)),f.alphaMap&&(m.alphaMap.value=f.alphaMap,t(f.alphaMap,m.alphaMapTransform)),f.bumpMap&&(m.bumpMap.value=f.bumpMap,t(f.bumpMap,m.bumpMapTransform),m.bumpScale.value=f.bumpScale,f.side===Et&&(m.bumpScale.value*=-1)),f.normalMap&&(m.normalMap.value=f.normalMap,t(f.normalMap,m.normalMapTransform),m.normalScale.value.copy(f.normalScale),f.side===Et&&m.normalScale.value.negate()),f.displacementMap&&(m.displacementMap.value=f.displacementMap,t(f.displacementMap,m.displacementMapTransform),m.displacementScale.value=f.displacementScale,m.displacementBias.value=f.displacementBias),f.emissiveMap&&(m.emissiveMap.value=f.emissiveMap,t(f.emissiveMap,m.emissiveMapTransform)),f.specularMap&&(m.specularMap.value=f.specularMap,t(f.specularMap,m.specularMapTransform)),f.alphaTest>0&&(m.alphaTest.value=f.alphaTest);let T=e.get(f),b=T.envMap,M=T.envMapRotation;b&&(m.envMap.value=b,ki.copy(M),ki.x*=-1,ki.y*=-1,ki.z*=-1,b.isCubeTexture&&b.isRenderTargetTexture===!1&&(ki.y*=-1,ki.z*=-1),m.envMapRotation.value.setFromMatrix4(wy.makeRotationFromEuler(ki)),m.flipEnvMap.value=b.isCubeTexture&&b.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=f.reflectivity,m.ior.value=f.ior,m.refractionRatio.value=f.refractionRatio),f.lightMap&&(m.lightMap.value=f.lightMap,m.lightMapIntensity.value=f.lightMapIntensity,t(f.lightMap,m.lightMapTransform)),f.aoMap&&(m.aoMap.value=f.aoMap,m.aoMapIntensity.value=f.aoMapIntensity,t(f.aoMap,m.aoMapTransform))}function o(m,f){m.diffuse.value.copy(f.color),m.opacity.value=f.opacity,f.map&&(m.map.value=f.map,t(f.map,m.mapTransform))}function a(m,f){m.dashSize.value=f.dashSize,m.totalSize.value=f.dashSize+f.gapSize,m.scale.value=f.scale}function c(m,f,T,b){m.diffuse.value.copy(f.color),m.opacity.value=f.opacity,m.size.value=f.size*T,m.scale.value=b*.5,f.map&&(m.map.value=f.map,t(f.map,m.uvTransform)),f.alphaMap&&(m.alphaMap.value=f.alphaMap,t(f.alphaMap,m.alphaMapTransform)),f.alphaTest>0&&(m.alphaTest.value=f.alphaTest)}function l(m,f){m.diffuse.value.copy(f.color),m.opacity.value=f.opacity,m.rotation.value=f.rotation,f.map&&(m.map.value=f.map,t(f.map,m.mapTransform)),f.alphaMap&&(m.alphaMap.value=f.alphaMap,t(f.alphaMap,m.alphaMapTransform)),f.alphaTest>0&&(m.alphaTest.value=f.alphaTest)}function u(m,f){m.specular.value.copy(f.specular),m.shininess.value=Math.max(f.shininess,1e-4)}function h(m,f){f.gradientMap&&(m.gradientMap.value=f.gradientMap)}function d(m,f){m.metalness.value=f.metalness,f.metalnessMap&&(m.metalnessMap.value=f.metalnessMap,t(f.metalnessMap,m.metalnessMapTransform)),m.roughness.value=f.roughness,f.roughnessMap&&(m.roughnessMap.value=f.roughnessMap,t(f.roughnessMap,m.roughnessMapTransform)),f.envMap&&(m.envMapIntensity.value=f.envMapIntensity)}function p(m,f,T){m.ior.value=f.ior,f.sheen>0&&(m.sheenColor.value.copy(f.sheenColor).multiplyScalar(f.sheen),m.sheenRoughness.value=f.sheenRoughness,f.sheenColorMap&&(m.sheenColorMap.value=f.sheenColorMap,t(f.sheenColorMap,m.sheenColorMapTransform)),f.sheenRoughnessMap&&(m.sheenRoughnessMap.value=f.sheenRoughnessMap,t(f.sheenRoughnessMap,m.sheenRoughnessMapTransform))),f.clearcoat>0&&(m.clearcoat.value=f.clearcoat,m.clearcoatRoughness.value=f.clearcoatRoughness,f.clearcoatMap&&(m.clearcoatMap.value=f.clearcoatMap,t(f.clearcoatMap,m.clearcoatMapTransform)),f.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=f.clearcoatRoughnessMap,t(f.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),f.clearcoatNormalMap&&(m.clearcoatNormalMap.value=f.clearcoatNormalMap,t(f.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(f.clearcoatNormalScale),f.side===Et&&m.clearcoatNormalScale.value.negate())),f.dispersion>0&&(m.dispersion.value=f.dispersion),f.iridescence>0&&(m.iridescence.value=f.iridescence,m.iridescenceIOR.value=f.iridescenceIOR,m.iridescenceThicknessMinimum.value=f.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=f.iridescenceThicknessRange[1],f.iridescenceMap&&(m.iridescenceMap.value=f.iridescenceMap,t(f.iridescenceMap,m.iridescenceMapTransform)),f.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=f.iridescenceThicknessMap,t(f.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),f.transmission>0&&(m.transmission.value=f.transmission,m.transmissionSamplerMap.value=T.texture,m.transmissionSamplerSize.value.set(T.width,T.height),f.transmissionMap&&(m.transmissionMap.value=f.transmissionMap,t(f.transmissionMap,m.transmissionMapTransform)),m.thickness.value=f.thickness,f.thicknessMap&&(m.thicknessMap.value=f.thicknessMap,t(f.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=f.attenuationDistance,m.attenuationColor.value.copy(f.attenuationColor)),f.anisotropy>0&&(m.anisotropyVector.value.set(f.anisotropy*Math.cos(f.anisotropyRotation),f.anisotropy*Math.sin(f.anisotropyRotation)),f.anisotropyMap&&(m.anisotropyMap.value=f.anisotropyMap,t(f.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=f.specularIntensity,m.specularColor.value.copy(f.specularColor),f.specularColorMap&&(m.specularColorMap.value=f.specularColorMap,t(f.specularColorMap,m.specularColorMapTransform)),f.specularIntensityMap&&(m.specularIntensityMap.value=f.specularIntensityMap,t(f.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,f){f.matcap&&(m.matcap.value=f.matcap)}function x(m,f){let T=e.get(f).light;m.referencePosition.value.setFromMatrixPosition(T.matrixWorld),m.nearDistance.value=T.shadow.camera.near,m.farDistance.value=T.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Cy(i,e,t,n){let s={},r={},o=[],a=i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS);function c(T,b){let M=b.program;n.uniformBlockBinding(T,M)}function l(T,b){let M=s[T.id];M===void 0&&(g(T),M=u(T),s[T.id]=M,T.addEventListener("dispose",m));let A=b.program;n.updateUBOMapping(T,A);let E=e.render.frame;r[T.id]!==E&&(d(T),r[T.id]=E)}function u(T){let b=h();T.__bindingPointIndex=b;let M=i.createBuffer(),A=T.__size,E=T.usage;return i.bindBuffer(i.UNIFORM_BUFFER,M),i.bufferData(i.UNIFORM_BUFFER,A,E),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,b,M),M}function h(){for(let T=0;T<a;T++)if(o.indexOf(T)===-1)return o.push(T),T;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(T){let b=s[T.id],M=T.uniforms,A=T.__cache;i.bindBuffer(i.UNIFORM_BUFFER,b);for(let E=0,C=M.length;E<C;E++){let D=Array.isArray(M[E])?M[E]:[M[E]];for(let S=0,y=D.length;S<y;S++){let P=D[S];if(p(P,E,S,A)===!0){let F=P.__offset,k=Array.isArray(P.value)?P.value:[P.value],H=0;for(let q=0;q<k.length;q++){let W=k[q],te=x(W);typeof W=="number"||typeof W=="boolean"?(P.__data[0]=W,i.bufferSubData(i.UNIFORM_BUFFER,F+H,P.__data)):W.isMatrix3?(P.__data[0]=W.elements[0],P.__data[1]=W.elements[1],P.__data[2]=W.elements[2],P.__data[3]=0,P.__data[4]=W.elements[3],P.__data[5]=W.elements[4],P.__data[6]=W.elements[5],P.__data[7]=0,P.__data[8]=W.elements[6],P.__data[9]=W.elements[7],P.__data[10]=W.elements[8],P.__data[11]=0):(W.toArray(P.__data,H),H+=te.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,F,P.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function p(T,b,M,A){let E=T.value,C=b+"_"+M;if(A[C]===void 0)return typeof E=="number"||typeof E=="boolean"?A[C]=E:A[C]=E.clone(),!0;{let D=A[C];if(typeof E=="number"||typeof E=="boolean"){if(D!==E)return A[C]=E,!0}else if(D.equals(E)===!1)return D.copy(E),!0}return!1}function g(T){let b=T.uniforms,M=0,A=16;for(let C=0,D=b.length;C<D;C++){let S=Array.isArray(b[C])?b[C]:[b[C]];for(let y=0,P=S.length;y<P;y++){let F=S[y],k=Array.isArray(F.value)?F.value:[F.value];for(let H=0,q=k.length;H<q;H++){let W=k[H],te=x(W),V=M%A,oe=V%te.boundary,ce=V+oe;M+=oe,ce!==0&&A-ce<te.storage&&(M+=A-ce),F.__data=new Float32Array(te.storage/Float32Array.BYTES_PER_ELEMENT),F.__offset=M,M+=te.storage}}}let E=M%A;return E>0&&(M+=A-E),T.__size=M,T.__cache={},this}function x(T){let b={boundary:0,storage:0};return typeof T=="number"||typeof T=="boolean"?(b.boundary=4,b.storage=4):T.isVector2?(b.boundary=8,b.storage=8):T.isVector3||T.isColor?(b.boundary=16,b.storage=12):T.isVector4?(b.boundary=16,b.storage=16):T.isMatrix3?(b.boundary=48,b.storage=48):T.isMatrix4?(b.boundary=64,b.storage=64):T.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",T),b}function m(T){let b=T.target;b.removeEventListener("dispose",m);let M=o.indexOf(b.__bindingPointIndex);o.splice(M,1),i.deleteBuffer(s[b.id]),delete s[b.id],delete r[b.id]}function f(){for(let T in s)i.deleteBuffer(s[T]);o=[],s={},r={}}return{bind:c,update:l,dispose:f}}var Ka=class{constructor(e={}){let{canvas:t=Ed(),context:n=null,depth:s=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:h=!1,reversedDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=o;let g=new Uint32Array(4),x=new Int32Array(4),m=null,f=null,T=[],b=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Zn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let M=this,A=!1;this._outputColorSpace=bt;let E=0,C=0,D=null,S=-1,y=null,P=new Je,F=new Je,k=null,H=new Pe(0),q=0,W=t.width,te=t.height,V=1,oe=null,ce=null,Te=new Je(0,0,W,te),re=new Je(0,0,W,te),ae=!1,Oe=new Ms,Re=!1,G=!1,K=new Ve,de=new L,Ce=new Je,_e={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},He=!1;function pt(){return D===null?V:1}let I=n;function et(_,w){return t.getContext(_,w)}try{let _={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:u,failIfMajorPerformanceCaveat:h};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${"180"}`),t.addEventListener("webglcontextlost",se,!1),t.addEventListener("webglcontextrestored",fe,!1),t.addEventListener("webglcontextcreationerror",ee,!1),I===null){let w="webgl2";if(I=et(w,_),I===null)throw et(w)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(_){throw console.error("THREE.WebGLRenderer: "+_.message),_}let Ue,Le,ye,dt,xe,ze,mt,Ze,R,v,z,Y,Z,X,Ee,J,ge,Se,Q,ue,Ne,ve,le,ke;function O(){Ue=new q0(I),Ue.init(),ve=new Ty(I,Ue),Le=new k0(I,Ue,e,ve),ye=new My(I,Ue),Le.reversedDepthBuffer&&d&&ye.buffers.depth.setReversed(!0),dt=new K0(I),xe=new cy,ze=new by(I,Ue,ye,xe,Le,ve,dt),mt=new V0(M),Ze=new Y0(M),R=new ng(I),le=new B0(I,R),v=new $0(I,R,dt,le),z=new J0(I,v,R,dt),Q=new Z0(I,Le,ze),J=new H0(xe),Y=new ly(M,mt,Ze,Ue,Le,le,J),Z=new Ry(M,xe),X=new hy,Ee=new _y(Ue),Se=new F0(M,mt,Ze,ye,z,p,c),ge=new vy(M,z,Le),ke=new Cy(I,dt,Le,ye),ue=new z0(I,Ue,dt),Ne=new j0(I,Ue,dt),dt.programs=Y.programs,M.capabilities=Le,M.extensions=Ue,M.properties=xe,M.renderLists=X,M.shadowMap=ge,M.state=ye,M.info=dt}O();let ne=new Yc(M,I);this.xr=ne,this.getContext=function(){return I},this.getContextAttributes=function(){return I.getContextAttributes()},this.forceContextLoss=function(){let _=Ue.get("WEBGL_lose_context");_&&_.loseContext()},this.forceContextRestore=function(){let _=Ue.get("WEBGL_lose_context");_&&_.restoreContext()},this.getPixelRatio=function(){return V},this.setPixelRatio=function(_){_!==void 0&&(V=_,this.setSize(W,te,!1))},this.getSize=function(_){return _.set(W,te)},this.setSize=function(_,w,U=!0){if(ne.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}W=_,te=w,t.width=Math.floor(_*V),t.height=Math.floor(w*V),U===!0&&(t.style.width=_+"px",t.style.height=w+"px"),this.setViewport(0,0,_,w)},this.getDrawingBufferSize=function(_){return _.set(W*V,te*V).floor()},this.setDrawingBufferSize=function(_,w,U){W=_,te=w,V=U,t.width=Math.floor(_*U),t.height=Math.floor(w*U),this.setViewport(0,0,_,w)},this.getCurrentViewport=function(_){return _.copy(P)},this.getViewport=function(_){return _.copy(Te)},this.setViewport=function(_,w,U,B){_.isVector4?Te.set(_.x,_.y,_.z,_.w):Te.set(_,w,U,B),ye.viewport(P.copy(Te).multiplyScalar(V).round())},this.getScissor=function(_){return _.copy(re)},this.setScissor=function(_,w,U,B){_.isVector4?re.set(_.x,_.y,_.z,_.w):re.set(_,w,U,B),ye.scissor(F.copy(re).multiplyScalar(V).round())},this.getScissorTest=function(){return ae},this.setScissorTest=function(_){ye.setScissorTest(ae=_)},this.setOpaqueSort=function(_){oe=_},this.setTransparentSort=function(_){ce=_},this.getClearColor=function(_){return _.copy(Se.getClearColor())},this.setClearColor=function(){Se.setClearColor(...arguments)},this.getClearAlpha=function(){return Se.getClearAlpha()},this.setClearAlpha=function(){Se.setClearAlpha(...arguments)},this.clear=function(_=!0,w=!0,U=!0){let B=0;if(_){let N=!1;if(D!==null){let j=D.texture.format;N=j===ga||j===ma||j===pa}if(N){let j=D.texture.type,ie=j===Mn||j===di||j===ws||j===Cs||j===ha||j===da,me=Se.getClearColor(),pe=Se.getClearAlpha(),be=me.r,De=me.g,Ae=me.b;ie?(g[0]=be,g[1]=De,g[2]=Ae,g[3]=pe,I.clearBufferuiv(I.COLOR,0,g)):(x[0]=be,x[1]=De,x[2]=Ae,x[3]=pe,I.clearBufferiv(I.COLOR,0,x))}else B|=I.COLOR_BUFFER_BIT}w&&(B|=I.DEPTH_BUFFER_BIT),U&&(B|=I.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),I.clear(B)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",se,!1),t.removeEventListener("webglcontextrestored",fe,!1),t.removeEventListener("webglcontextcreationerror",ee,!1),Se.dispose(),X.dispose(),Ee.dispose(),xe.dispose(),mt.dispose(),Ze.dispose(),z.dispose(),le.dispose(),ke.dispose(),Y.dispose(),ne.dispose(),ne.removeEventListener("sessionstart",sn),ne.removeEventListener("sessionend",ks),bn.stop()};function se(_){_.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),A=!0}function fe(){console.log("THREE.WebGLRenderer: Context Restored."),A=!1;let _=dt.autoReset,w=ge.enabled,U=ge.autoUpdate,B=ge.needsUpdate,N=ge.type;O(),dt.autoReset=_,ge.enabled=w,ge.autoUpdate=U,ge.needsUpdate=B,ge.type=N}function ee(_){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",_.statusMessage)}function $(_){let w=_.target;w.removeEventListener("dispose",$),Me(w)}function Me(_){Fe(_),xe.remove(_)}function Fe(_){let w=xe.get(_).programs;w!==void 0&&(w.forEach(function(U){Y.releaseProgram(U)}),_.isShaderMaterial&&Y.releaseShaderCache(_))}this.renderBufferDirect=function(_,w,U,B,N,j){w===null&&(w=_e);let ie=N.isMesh&&N.matrixWorld.determinant()<0,me=hl(_,w,U,B,N);ye.setMaterial(B,ie);let pe=U.index,be=1;if(B.wireframe===!0){if(pe=v.getWireframeAttribute(U),pe===void 0)return;be=2}let De=U.drawRange,Ae=U.attributes.position,qe=De.start*be,tt=(De.start+De.count)*be;j!==null&&(qe=Math.max(qe,j.start*be),tt=Math.min(tt,(j.start+j.count)*be)),pe!==null?(qe=Math.max(qe,0),tt=Math.min(tt,pe.count)):Ae!=null&&(qe=Math.max(qe,0),tt=Math.min(tt,Ae.count));let ft=tt-qe;if(ft<0||ft===1/0)return;le.setup(N,B,me,U,pe);let rt,nt=ue;if(pe!==null&&(rt=R.get(pe),nt=Ne,nt.setIndex(rt)),N.isMesh)B.wireframe===!0?(ye.setLineWidth(B.wireframeLinewidth*pt()),nt.setMode(I.LINES)):nt.setMode(I.TRIANGLES);else if(N.isLine){let Ie=B.linewidth;Ie===void 0&&(Ie=1),ye.setLineWidth(Ie*pt()),N.isLineSegments?nt.setMode(I.LINES):N.isLineLoop?nt.setMode(I.LINE_LOOP):nt.setMode(I.LINE_STRIP)}else N.isPoints?nt.setMode(I.POINTS):N.isSprite&&nt.setMode(I.TRIANGLES);if(N.isBatchedMesh)if(N._multiDrawInstances!==null)_s("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),nt.renderMultiDrawInstances(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount,N._multiDrawInstances);else if(Ue.get("WEBGL_multi_draw"))nt.renderMultiDraw(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount);else{let Ie=N._multiDrawStarts,lt=N._multiDrawCounts,je=N._multiDrawCount,Kt=pe?R.get(pe).bytesPerElement:1,Yi=xe.get(B).currentProgram.getUniforms();for(let Zt=0;Zt<je;Zt++)Yi.setValue(I,"_gl_DrawID",Zt),nt.render(Ie[Zt]/Kt,lt[Zt])}else if(N.isInstancedMesh)nt.renderInstances(qe,ft,N.count);else if(U.isInstancedBufferGeometry){let Ie=U._maxInstanceCount!==void 0?U._maxInstanceCount:1/0,lt=Math.min(U.instanceCount,Ie);nt.renderInstances(qe,ft,lt)}else nt.render(qe,ft)};function st(_,w,U){_.transparent===!0&&_.side===Bt&&_.forceSinglePass===!1?(_.side=Et,_.needsUpdate=!0,Xi(_,w,U),_.side=xn,_.needsUpdate=!0,Xi(_,w,U),_.side=Bt):Xi(_,w,U)}this.compile=function(_,w,U=null){U===null&&(U=_),f=Ee.get(U),f.init(w),b.push(f),U.traverseVisible(function(N){N.isLight&&N.layers.test(w.layers)&&(f.pushLight(N),N.castShadow&&f.pushShadow(N))}),_!==U&&_.traverseVisible(function(N){N.isLight&&N.layers.test(w.layers)&&(f.pushLight(N),N.castShadow&&f.pushShadow(N))}),f.setupLights();let B=new Set;return _.traverse(function(N){if(!(N.isMesh||N.isPoints||N.isLine||N.isSprite))return;let j=N.material;if(j)if(Array.isArray(j))for(let ie=0;ie<j.length;ie++){let me=j[ie];st(me,U,N),B.add(me)}else st(j,U,N),B.add(j)}),f=b.pop(),B},this.compileAsync=function(_,w,U=null){let B=this.compile(_,w,U);return new Promise(N=>{function j(){if(B.forEach(function(ie){xe.get(ie).currentProgram.isReady()&&B.delete(ie)}),B.size===0){N(_);return}setTimeout(j,10)}Ue.get("KHR_parallel_shader_compile")!==null?j():setTimeout(j,10)})};let Ye=null;function nn(_){Ye&&Ye(_)}function sn(){bn.stop()}function ks(){bn.start()}let bn=new tf;bn.setAnimationLoop(nn),typeof self<"u"&&bn.setContext(self),this.setAnimationLoop=function(_){Ye=_,ne.setAnimationLoop(_),_===null?bn.stop():bn.start()},ne.addEventListener("sessionstart",sn),ne.addEventListener("sessionend",ks),this.render=function(_,w){if(w!==void 0&&w.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(A===!0)return;if(_.matrixWorldAutoUpdate===!0&&_.updateMatrixWorld(),w.parent===null&&w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),ne.enabled===!0&&ne.isPresenting===!0&&(ne.cameraAutoUpdate===!0&&ne.updateCamera(w),w=ne.getCamera()),_.isScene===!0&&_.onBeforeRender(M,_,w,D),f=Ee.get(_,b.length),f.init(w),b.push(f),K.multiplyMatrices(w.projectionMatrix,w.matrixWorldInverse),Oe.setFromProjectionMatrix(K,gn,w.reversedDepth),G=this.localClippingEnabled,Re=J.init(this.clippingPlanes,G),m=X.get(_,T.length),m.init(),T.push(m),ne.enabled===!0&&ne.isPresenting===!0){let j=M.xr.getDepthSensingMesh();j!==null&&Hs(j,w,-1/0,M.sortObjects)}Hs(_,w,0,M.sortObjects),m.finish(),M.sortObjects===!0&&m.sort(oe,ce),He=ne.enabled===!1||ne.isPresenting===!1||ne.hasDepthSensing()===!1,He&&Se.addToRenderList(m,_),this.info.render.frame++,Re===!0&&J.beginShadows();let U=f.state.shadowsArray;ge.render(U,_,w),Re===!0&&J.endShadows(),this.info.autoReset===!0&&this.info.reset();let B=m.opaque,N=m.transmissive;if(f.setupLights(),w.isArrayCamera){let j=w.cameras;if(N.length>0)for(let ie=0,me=j.length;ie<me;ie++){let pe=j[ie];Vs(B,N,_,pe)}He&&Se.render(_);for(let ie=0,me=j.length;ie<me;ie++){let pe=j[ie];Yr(m,_,pe,pe.viewport)}}else N.length>0&&Vs(B,N,_,w),He&&Se.render(_),Yr(m,_,w);D!==null&&C===0&&(ze.updateMultisampleRenderTarget(D),ze.updateRenderTargetMipmap(D)),_.isScene===!0&&_.onAfterRender(M,_,w),le.resetDefaultState(),S=-1,y=null,b.pop(),b.length>0?(f=b[b.length-1],Re===!0&&J.setGlobalState(M.clippingPlanes,f.state.camera)):f=null,T.pop(),T.length>0?m=T[T.length-1]:m=null};function Hs(_,w,U,B){if(_.visible===!1)return;if(_.layers.test(w.layers)){if(_.isGroup)U=_.renderOrder;else if(_.isLOD)_.autoUpdate===!0&&_.update(w);else if(_.isLight)f.pushLight(_),_.castShadow&&f.pushShadow(_);else if(_.isSprite){if(!_.frustumCulled||Oe.intersectsSprite(_)){B&&Ce.setFromMatrixPosition(_.matrixWorld).applyMatrix4(K);let ie=z.update(_),me=_.material;me.visible&&m.push(_,ie,me,U,Ce.z,null)}}else if((_.isMesh||_.isLine||_.isPoints)&&(!_.frustumCulled||Oe.intersectsObject(_))){let ie=z.update(_),me=_.material;if(B&&(_.boundingSphere!==void 0?(_.boundingSphere===null&&_.computeBoundingSphere(),Ce.copy(_.boundingSphere.center)):(ie.boundingSphere===null&&ie.computeBoundingSphere(),Ce.copy(ie.boundingSphere.center)),Ce.applyMatrix4(_.matrixWorld).applyMatrix4(K)),Array.isArray(me)){let pe=ie.groups;for(let be=0,De=pe.length;be<De;be++){let Ae=pe[be],qe=me[Ae.materialIndex];qe&&qe.visible&&m.push(_,ie,qe,U,Ce.z,Ae)}}else me.visible&&m.push(_,ie,me,U,Ce.z,null)}}let j=_.children;for(let ie=0,me=j.length;ie<me;ie++)Hs(j[ie],w,U,B)}function Yr(_,w,U,B){let N=_.opaque,j=_.transmissive,ie=_.transparent;f.setupLightsView(U),Re===!0&&J.setGlobalState(M.clippingPlanes,U),B&&ye.viewport(P.copy(B)),N.length>0&&Wi(N,w,U),j.length>0&&Wi(j,w,U),ie.length>0&&Wi(ie,w,U),ye.buffers.depth.setTest(!0),ye.buffers.depth.setMask(!0),ye.buffers.color.setMask(!0),ye.setPolygonOffset(!1)}function Vs(_,w,U,B){if((U.isScene===!0?U.overrideMaterial:null)!==null)return;f.state.transmissionRenderTarget[B.id]===void 0&&(f.state.transmissionRenderTarget[B.id]=new Rn(1,1,{generateMipmaps:!0,type:Ue.has("EXT_color_buffer_half_float")||Ue.has("EXT_color_buffer_float")?Rs:Mn,minFilter:Sn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Ke.workingColorSpace}));let j=f.state.transmissionRenderTarget[B.id],ie=B.viewport||P;j.setSize(ie.z*M.transmissionResolutionScale,ie.w*M.transmissionResolutionScale);let me=M.getRenderTarget(),pe=M.getActiveCubeFace(),be=M.getActiveMipmapLevel();M.setRenderTarget(j),M.getClearColor(H),q=M.getClearAlpha(),q<1&&M.setClearColor(16777215,.5),M.clear(),He&&Se.render(U);let De=M.toneMapping;M.toneMapping=Zn;let Ae=B.viewport;if(B.viewport!==void 0&&(B.viewport=void 0),f.setupLightsView(B),Re===!0&&J.setGlobalState(M.clippingPlanes,B),Wi(_,U,B),ze.updateMultisampleRenderTarget(j),ze.updateRenderTargetMipmap(j),Ue.has("WEBGL_multisampled_render_to_texture")===!1){let qe=!1;for(let tt=0,ft=w.length;tt<ft;tt++){let rt=w[tt],nt=rt.object,Ie=rt.geometry,lt=rt.material,je=rt.group;if(lt.side===Bt&&nt.layers.test(B.layers)){let Kt=lt.side;lt.side=Et,lt.needsUpdate=!0,qr(nt,U,B,Ie,lt,je),lt.side=Kt,lt.needsUpdate=!0,qe=!0}}qe===!0&&(ze.updateMultisampleRenderTarget(j),ze.updateRenderTargetMipmap(j))}M.setRenderTarget(me,pe,be),M.setClearColor(H,q),Ae!==void 0&&(B.viewport=Ae),M.toneMapping=De}function Wi(_,w,U){let B=w.isScene===!0?w.overrideMaterial:null;for(let N=0,j=_.length;N<j;N++){let ie=_[N],me=ie.object,pe=ie.geometry,be=ie.group,De=ie.material;De.allowOverride===!0&&B!==null&&(De=B),me.layers.test(U.layers)&&qr(me,w,U,pe,De,be)}}function qr(_,w,U,B,N,j){_.onBeforeRender(M,w,U,B,N,j),_.modelViewMatrix.multiplyMatrices(U.matrixWorldInverse,_.matrixWorld),_.normalMatrix.getNormalMatrix(_.modelViewMatrix),N.onBeforeRender(M,w,U,B,_,j),N.transparent===!0&&N.side===Bt&&N.forceSinglePass===!1?(N.side=Et,N.needsUpdate=!0,M.renderBufferDirect(U,w,B,N,_,j),N.side=xn,N.needsUpdate=!0,M.renderBufferDirect(U,w,B,N,_,j),N.side=Bt):M.renderBufferDirect(U,w,B,N,_,j),_.onAfterRender(M,w,U,B,N,j)}function Xi(_,w,U){w.isScene!==!0&&(w=_e);let B=xe.get(_),N=f.state.lights,j=f.state.shadowsArray,ie=N.state.version,me=Y.getParameters(_,N.state,j,w,U),pe=Y.getProgramCacheKey(me),be=B.programs;B.environment=_.isMeshStandardMaterial?w.environment:null,B.fog=w.fog,B.envMap=(_.isMeshStandardMaterial?Ze:mt).get(_.envMap||B.environment),B.envMapRotation=B.environment!==null&&_.envMap===null?w.environmentRotation:_.envMapRotation,be===void 0&&(_.addEventListener("dispose",$),be=new Map,B.programs=be);let De=be.get(pe);if(De!==void 0){if(B.currentProgram===De&&B.lightsStateVersion===ie)return jr(_,me),De}else me.uniforms=Y.getUniforms(_),_.onBeforeCompile(me,M),De=Y.acquireProgram(me,pe),be.set(pe,De),B.uniforms=me.uniforms;let Ae=B.uniforms;return(!_.isShaderMaterial&&!_.isRawShaderMaterial||_.clipping===!0)&&(Ae.clippingPlanes=J.uniform),jr(_,me),B.needsLights=fl(_),B.lightsStateVersion=ie,B.needsLights&&(Ae.ambientLightColor.value=N.state.ambient,Ae.lightProbe.value=N.state.probe,Ae.directionalLights.value=N.state.directional,Ae.directionalLightShadows.value=N.state.directionalShadow,Ae.spotLights.value=N.state.spot,Ae.spotLightShadows.value=N.state.spotShadow,Ae.rectAreaLights.value=N.state.rectArea,Ae.ltc_1.value=N.state.rectAreaLTC1,Ae.ltc_2.value=N.state.rectAreaLTC2,Ae.pointLights.value=N.state.point,Ae.pointLightShadows.value=N.state.pointShadow,Ae.hemisphereLights.value=N.state.hemi,Ae.directionalShadowMap.value=N.state.directionalShadowMap,Ae.directionalShadowMatrix.value=N.state.directionalShadowMatrix,Ae.spotShadowMap.value=N.state.spotShadowMap,Ae.spotLightMatrix.value=N.state.spotLightMatrix,Ae.spotLightMap.value=N.state.spotLightMap,Ae.pointShadowMap.value=N.state.pointShadowMap,Ae.pointShadowMatrix.value=N.state.pointShadowMatrix),B.currentProgram=De,B.uniformsList=null,De}function $r(_){if(_.uniformsList===null){let w=_.currentProgram.getUniforms();_.uniformsList=Ns.seqWithValue(w.seq,_.uniforms)}return _.uniformsList}function jr(_,w){let U=xe.get(_);U.outputColorSpace=w.outputColorSpace,U.batching=w.batching,U.batchingColor=w.batchingColor,U.instancing=w.instancing,U.instancingColor=w.instancingColor,U.instancingMorph=w.instancingMorph,U.skinning=w.skinning,U.morphTargets=w.morphTargets,U.morphNormals=w.morphNormals,U.morphColors=w.morphColors,U.morphTargetsCount=w.morphTargetsCount,U.numClippingPlanes=w.numClippingPlanes,U.numIntersection=w.numClipIntersection,U.vertexAlphas=w.vertexAlphas,U.vertexTangents=w.vertexTangents,U.toneMapping=w.toneMapping}function hl(_,w,U,B,N){w.isScene!==!0&&(w=_e),ze.resetTextureUnits();let j=w.fog,ie=B.isMeshStandardMaterial?w.environment:null,me=D===null?M.outputColorSpace:D.isXRRenderTarget===!0?D.texture.colorSpace:Lt,pe=(B.isMeshStandardMaterial?Ze:mt).get(B.envMap||ie),be=B.vertexColors===!0&&!!U.attributes.color&&U.attributes.color.itemSize===4,De=!!U.attributes.tangent&&(!!B.normalMap||B.anisotropy>0),Ae=!!U.morphAttributes.position,qe=!!U.morphAttributes.normal,tt=!!U.morphAttributes.color,ft=Zn;B.toneMapped&&(D===null||D.isXRRenderTarget===!0)&&(ft=M.toneMapping);let rt=U.morphAttributes.position||U.morphAttributes.normal||U.morphAttributes.color,nt=rt!==void 0?rt.length:0,Ie=xe.get(B),lt=f.state.lights;if(Re===!0&&(G===!0||_!==y)){let kt=_===y&&B.id===S;J.setState(B,_,kt)}let je=!1;B.version===Ie.__version?(Ie.needsLights&&Ie.lightsStateVersion!==lt.state.version||Ie.outputColorSpace!==me||N.isBatchedMesh&&Ie.batching===!1||!N.isBatchedMesh&&Ie.batching===!0||N.isBatchedMesh&&Ie.batchingColor===!0&&N.colorTexture===null||N.isBatchedMesh&&Ie.batchingColor===!1&&N.colorTexture!==null||N.isInstancedMesh&&Ie.instancing===!1||!N.isInstancedMesh&&Ie.instancing===!0||N.isSkinnedMesh&&Ie.skinning===!1||!N.isSkinnedMesh&&Ie.skinning===!0||N.isInstancedMesh&&Ie.instancingColor===!0&&N.instanceColor===null||N.isInstancedMesh&&Ie.instancingColor===!1&&N.instanceColor!==null||N.isInstancedMesh&&Ie.instancingMorph===!0&&N.morphTexture===null||N.isInstancedMesh&&Ie.instancingMorph===!1&&N.morphTexture!==null||Ie.envMap!==pe||B.fog===!0&&Ie.fog!==j||Ie.numClippingPlanes!==void 0&&(Ie.numClippingPlanes!==J.numPlanes||Ie.numIntersection!==J.numIntersection)||Ie.vertexAlphas!==be||Ie.vertexTangents!==De||Ie.morphTargets!==Ae||Ie.morphNormals!==qe||Ie.morphColors!==tt||Ie.toneMapping!==ft||Ie.morphTargetsCount!==nt)&&(je=!0):(je=!0,Ie.__version=B.version);let Kt=Ie.currentProgram;je===!0&&(Kt=Xi(B,w,N));let Yi=!1,Zt=!1,Gs=!1,gt=Kt.getUniforms(),rn=Ie.uniforms;if(ye.useProgram(Kt.program)&&(Yi=!0,Zt=!0,Gs=!0),B.id!==S&&(S=B.id,Zt=!0),Yi||y!==_){ye.buffers.depth.getReversed()&&_.reversedDepth!==!0&&(_._reversedDepth=!0,_.updateProjectionMatrix()),gt.setValue(I,"projectionMatrix",_.projectionMatrix),gt.setValue(I,"viewMatrix",_.matrixWorldInverse);let Xt=gt.map.cameraPosition;Xt!==void 0&&Xt.setValue(I,de.setFromMatrixPosition(_.matrixWorld)),Le.logarithmicDepthBuffer&&gt.setValue(I,"logDepthBufFC",2/(Math.log(_.far+1)/Math.LN2)),(B.isMeshPhongMaterial||B.isMeshToonMaterial||B.isMeshLambertMaterial||B.isMeshBasicMaterial||B.isMeshStandardMaterial||B.isShaderMaterial)&&gt.setValue(I,"isOrthographic",_.isOrthographicCamera===!0),y!==_&&(y=_,Zt=!0,Gs=!0)}if(N.isSkinnedMesh){gt.setOptional(I,N,"bindMatrix"),gt.setOptional(I,N,"bindMatrixInverse");let kt=N.skeleton;kt&&(kt.boneTexture===null&&kt.computeBoneTexture(),gt.setValue(I,"boneTexture",kt.boneTexture,ze))}N.isBatchedMesh&&(gt.setOptional(I,N,"batchingTexture"),gt.setValue(I,"batchingTexture",N._matricesTexture,ze),gt.setOptional(I,N,"batchingIdTexture"),gt.setValue(I,"batchingIdTexture",N._indirectTexture,ze),gt.setOptional(I,N,"batchingColorTexture"),N._colorsTexture!==null&&gt.setValue(I,"batchingColorTexture",N._colorsTexture,ze));let on=U.morphAttributes;if((on.position!==void 0||on.normal!==void 0||on.color!==void 0)&&Q.update(N,U,Kt),(Zt||Ie.receiveShadow!==N.receiveShadow)&&(Ie.receiveShadow=N.receiveShadow,gt.setValue(I,"receiveShadow",N.receiveShadow)),B.isMeshGouraudMaterial&&B.envMap!==null&&(rn.envMap.value=pe,rn.flipEnvMap.value=pe.isCubeTexture&&pe.isRenderTargetTexture===!1?-1:1),B.isMeshStandardMaterial&&B.envMap===null&&w.environment!==null&&(rn.envMapIntensity.value=w.environmentIntensity),Zt&&(gt.setValue(I,"toneMappingExposure",M.toneMappingExposure),Ie.needsLights&&dl(rn,Gs),j&&B.fog===!0&&Z.refreshFogUniforms(rn,j),Z.refreshMaterialUniforms(rn,B,V,te,f.state.transmissionRenderTarget[_.id]),Ns.upload(I,$r(Ie),rn,ze)),B.isShaderMaterial&&B.uniformsNeedUpdate===!0&&(Ns.upload(I,$r(Ie),rn,ze),B.uniformsNeedUpdate=!1),B.isSpriteMaterial&&gt.setValue(I,"center",N.center),gt.setValue(I,"modelViewMatrix",N.modelViewMatrix),gt.setValue(I,"normalMatrix",N.normalMatrix),gt.setValue(I,"modelMatrix",N.matrixWorld),B.isShaderMaterial||B.isRawShaderMaterial){let kt=B.uniformsGroups;for(let Xt=0,gl=kt.length;Xt<gl;Xt++){let mi=kt[Xt];ke.update(mi,Kt),ke.bind(mi,Kt)}}return Kt}function dl(_,w){_.ambientLightColor.needsUpdate=w,_.lightProbe.needsUpdate=w,_.directionalLights.needsUpdate=w,_.directionalLightShadows.needsUpdate=w,_.pointLights.needsUpdate=w,_.pointLightShadows.needsUpdate=w,_.spotLights.needsUpdate=w,_.spotLightShadows.needsUpdate=w,_.rectAreaLights.needsUpdate=w,_.hemisphereLights.needsUpdate=w}function fl(_){return _.isMeshLambertMaterial||_.isMeshToonMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isShadowMaterial||_.isShaderMaterial&&_.lights===!0}this.getActiveCubeFace=function(){return E},this.getActiveMipmapLevel=function(){return C},this.getRenderTarget=function(){return D},this.setRenderTargetTextures=function(_,w,U){let B=xe.get(_);B.__autoAllocateDepthBuffer=_.resolveDepthBuffer===!1,B.__autoAllocateDepthBuffer===!1&&(B.__useRenderToTexture=!1),xe.get(_.texture).__webglTexture=w,xe.get(_.depthTexture).__webglTexture=B.__autoAllocateDepthBuffer?void 0:U,B.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(_,w){let U=xe.get(_);U.__webglFramebuffer=w,U.__useDefaultFramebuffer=w===void 0};let pl=I.createFramebuffer();this.setRenderTarget=function(_,w=0,U=0){D=_,E=w,C=U;let B=!0,N=null,j=!1,ie=!1;if(_){let pe=xe.get(_);if(pe.__useDefaultFramebuffer!==void 0)ye.bindFramebuffer(I.FRAMEBUFFER,null),B=!1;else if(pe.__webglFramebuffer===void 0)ze.setupRenderTarget(_);else if(pe.__hasExternalTextures)ze.rebindTextures(_,xe.get(_.texture).__webglTexture,xe.get(_.depthTexture).__webglTexture);else if(_.depthBuffer){let Ae=_.depthTexture;if(pe.__boundDepthTexture!==Ae){if(Ae!==null&&xe.has(Ae)&&(_.width!==Ae.image.width||_.height!==Ae.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");ze.setupDepthRenderbuffer(_)}}let be=_.texture;(be.isData3DTexture||be.isDataArrayTexture||be.isCompressedArrayTexture)&&(ie=!0);let De=xe.get(_).__webglFramebuffer;_.isWebGLCubeRenderTarget?(Array.isArray(De[w])?N=De[w][U]:N=De[w],j=!0):_.samples>0&&ze.useMultisampledRTT(_)===!1?N=xe.get(_).__webglMultisampledFramebuffer:Array.isArray(De)?N=De[U]:N=De,P.copy(_.viewport),F.copy(_.scissor),k=_.scissorTest}else P.copy(Te).multiplyScalar(V).floor(),F.copy(re).multiplyScalar(V).floor(),k=ae;if(U!==0&&(N=pl),ye.bindFramebuffer(I.FRAMEBUFFER,N)&&B&&ye.drawBuffers(_,N),ye.viewport(P),ye.scissor(F),ye.setScissorTest(k),j){let pe=xe.get(_.texture);I.framebufferTexture2D(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_CUBE_MAP_POSITIVE_X+w,pe.__webglTexture,U)}else if(ie){let pe=w;for(let be=0;be<_.textures.length;be++){let De=xe.get(_.textures[be]);I.framebufferTextureLayer(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0+be,De.__webglTexture,U,pe)}}else if(_!==null&&U!==0){let pe=xe.get(_.texture);I.framebufferTexture2D(I.FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,pe.__webglTexture,U)}S=-1},this.readRenderTargetPixels=function(_,w,U,B,N,j,ie,me=0){if(!(_&&_.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let pe=xe.get(_).__webglFramebuffer;if(_.isWebGLCubeRenderTarget&&ie!==void 0&&(pe=pe[ie]),pe){ye.bindFramebuffer(I.FRAMEBUFFER,pe);try{let be=_.textures[me],De=be.format,Ae=be.type;if(!Le.textureFormatReadable(De)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Le.textureTypeReadable(Ae)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}w>=0&&w<=_.width-B&&U>=0&&U<=_.height-N&&(_.textures.length>1&&I.readBuffer(I.COLOR_ATTACHMENT0+me),I.readPixels(w,U,B,N,ve.convert(De),ve.convert(Ae),j))}finally{let be=D!==null?xe.get(D).__webglFramebuffer:null;ye.bindFramebuffer(I.FRAMEBUFFER,be)}}},this.readRenderTargetPixelsAsync=async function(_,w,U,B,N,j,ie,me=0){if(!(_&&_.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let pe=xe.get(_).__webglFramebuffer;if(_.isWebGLCubeRenderTarget&&ie!==void 0&&(pe=pe[ie]),pe)if(w>=0&&w<=_.width-B&&U>=0&&U<=_.height-N){ye.bindFramebuffer(I.FRAMEBUFFER,pe);let be=_.textures[me],De=be.format,Ae=be.type;if(!Le.textureFormatReadable(De))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Le.textureTypeReadable(Ae))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let qe=I.createBuffer();I.bindBuffer(I.PIXEL_PACK_BUFFER,qe),I.bufferData(I.PIXEL_PACK_BUFFER,j.byteLength,I.STREAM_READ),_.textures.length>1&&I.readBuffer(I.COLOR_ATTACHMENT0+me),I.readPixels(w,U,B,N,ve.convert(De),ve.convert(Ae),0);let tt=D!==null?xe.get(D).__webglFramebuffer:null;ye.bindFramebuffer(I.FRAMEBUFFER,tt);let ft=I.fenceSync(I.SYNC_GPU_COMMANDS_COMPLETE,0);return I.flush(),await Ad(I,ft,4),I.bindBuffer(I.PIXEL_PACK_BUFFER,qe),I.getBufferSubData(I.PIXEL_PACK_BUFFER,0,j),I.deleteBuffer(qe),I.deleteSync(ft),j}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(_,w=null,U=0){let B=Math.pow(2,-U),N=Math.floor(_.image.width*B),j=Math.floor(_.image.height*B),ie=w!==null?w.x:0,me=w!==null?w.y:0;ze.setTexture2D(_,0),I.copyTexSubImage2D(I.TEXTURE_2D,U,0,0,ie,me,N,j),ye.unbindTexture()};let Kr=I.createFramebuffer(),ml=I.createFramebuffer();this.copyTextureToTexture=function(_,w,U=null,B=null,N=0,j=null){j===null&&(N!==0?(_s("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),j=N,N=0):j=0);let ie,me,pe,be,De,Ae,qe,tt,ft,rt=_.isCompressedTexture?_.mipmaps[j]:_.image;if(U!==null)ie=U.max.x-U.min.x,me=U.max.y-U.min.y,pe=U.isBox3?U.max.z-U.min.z:1,be=U.min.x,De=U.min.y,Ae=U.isBox3?U.min.z:0;else{let on=Math.pow(2,-N);ie=Math.floor(rt.width*on),me=Math.floor(rt.height*on),_.isDataArrayTexture?pe=rt.depth:_.isData3DTexture?pe=Math.floor(rt.depth*on):pe=1,be=0,De=0,Ae=0}B!==null?(qe=B.x,tt=B.y,ft=B.z):(qe=0,tt=0,ft=0);let nt=ve.convert(w.format),Ie=ve.convert(w.type),lt;w.isData3DTexture?(ze.setTexture3D(w,0),lt=I.TEXTURE_3D):w.isDataArrayTexture||w.isCompressedArrayTexture?(ze.setTexture2DArray(w,0),lt=I.TEXTURE_2D_ARRAY):(ze.setTexture2D(w,0),lt=I.TEXTURE_2D),I.pixelStorei(I.UNPACK_FLIP_Y_WEBGL,w.flipY),I.pixelStorei(I.UNPACK_PREMULTIPLY_ALPHA_WEBGL,w.premultiplyAlpha),I.pixelStorei(I.UNPACK_ALIGNMENT,w.unpackAlignment);let je=I.getParameter(I.UNPACK_ROW_LENGTH),Kt=I.getParameter(I.UNPACK_IMAGE_HEIGHT),Yi=I.getParameter(I.UNPACK_SKIP_PIXELS),Zt=I.getParameter(I.UNPACK_SKIP_ROWS),Gs=I.getParameter(I.UNPACK_SKIP_IMAGES);I.pixelStorei(I.UNPACK_ROW_LENGTH,rt.width),I.pixelStorei(I.UNPACK_IMAGE_HEIGHT,rt.height),I.pixelStorei(I.UNPACK_SKIP_PIXELS,be),I.pixelStorei(I.UNPACK_SKIP_ROWS,De),I.pixelStorei(I.UNPACK_SKIP_IMAGES,Ae);let gt=_.isDataArrayTexture||_.isData3DTexture,rn=w.isDataArrayTexture||w.isData3DTexture;if(_.isDepthTexture){let on=xe.get(_),kt=xe.get(w),Xt=xe.get(on.__renderTarget),gl=xe.get(kt.__renderTarget);ye.bindFramebuffer(I.READ_FRAMEBUFFER,Xt.__webglFramebuffer),ye.bindFramebuffer(I.DRAW_FRAMEBUFFER,gl.__webglFramebuffer);for(let mi=0;mi<pe;mi++)gt&&(I.framebufferTextureLayer(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,xe.get(_).__webglTexture,N,Ae+mi),I.framebufferTextureLayer(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,xe.get(w).__webglTexture,j,ft+mi)),I.blitFramebuffer(be,De,ie,me,qe,tt,ie,me,I.DEPTH_BUFFER_BIT,I.NEAREST);ye.bindFramebuffer(I.READ_FRAMEBUFFER,null),ye.bindFramebuffer(I.DRAW_FRAMEBUFFER,null)}else if(N!==0||_.isRenderTargetTexture||xe.has(_)){let on=xe.get(_),kt=xe.get(w);ye.bindFramebuffer(I.READ_FRAMEBUFFER,Kr),ye.bindFramebuffer(I.DRAW_FRAMEBUFFER,ml);for(let Xt=0;Xt<pe;Xt++)gt?I.framebufferTextureLayer(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,on.__webglTexture,N,Ae+Xt):I.framebufferTexture2D(I.READ_FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,on.__webglTexture,N),rn?I.framebufferTextureLayer(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,kt.__webglTexture,j,ft+Xt):I.framebufferTexture2D(I.DRAW_FRAMEBUFFER,I.COLOR_ATTACHMENT0,I.TEXTURE_2D,kt.__webglTexture,j),N!==0?I.blitFramebuffer(be,De,ie,me,qe,tt,ie,me,I.COLOR_BUFFER_BIT,I.NEAREST):rn?I.copyTexSubImage3D(lt,j,qe,tt,ft+Xt,be,De,ie,me):I.copyTexSubImage2D(lt,j,qe,tt,be,De,ie,me);ye.bindFramebuffer(I.READ_FRAMEBUFFER,null),ye.bindFramebuffer(I.DRAW_FRAMEBUFFER,null)}else rn?_.isDataTexture||_.isData3DTexture?I.texSubImage3D(lt,j,qe,tt,ft,ie,me,pe,nt,Ie,rt.data):w.isCompressedArrayTexture?I.compressedTexSubImage3D(lt,j,qe,tt,ft,ie,me,pe,nt,rt.data):I.texSubImage3D(lt,j,qe,tt,ft,ie,me,pe,nt,Ie,rt):_.isDataTexture?I.texSubImage2D(I.TEXTURE_2D,j,qe,tt,ie,me,nt,Ie,rt.data):_.isCompressedTexture?I.compressedTexSubImage2D(I.TEXTURE_2D,j,qe,tt,rt.width,rt.height,nt,rt.data):I.texSubImage2D(I.TEXTURE_2D,j,qe,tt,ie,me,nt,Ie,rt);I.pixelStorei(I.UNPACK_ROW_LENGTH,je),I.pixelStorei(I.UNPACK_IMAGE_HEIGHT,Kt),I.pixelStorei(I.UNPACK_SKIP_PIXELS,Yi),I.pixelStorei(I.UNPACK_SKIP_ROWS,Zt),I.pixelStorei(I.UNPACK_SKIP_IMAGES,Gs),j===0&&w.generateMipmaps&&I.generateMipmap(lt),ye.unbindTexture()},this.initRenderTarget=function(_){xe.get(_).__webglFramebuffer===void 0&&ze.setupRenderTarget(_)},this.initTexture=function(_){_.isCubeTexture?ze.setTextureCube(_,0):_.isData3DTexture?ze.setTexture3D(_,0):_.isDataArrayTexture||_.isCompressedArrayTexture?ze.setTexture2DArray(_,0):ze.setTexture2D(_,0),ye.unbindTexture()},this.resetState=function(){E=0,C=0,D=null,ye.reset(),le.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return gn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Ke._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ke._getUnpackColorSpace()}};var af={ur3:{links:[{x:0,y:0,z:.1519,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.24365,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.21325,y:0,z:.11235,roll:0,pitch:0,yaw:0},{x:0,y:-.08535,z:-1750557762378351e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0819,z:-1679797079540562e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],null]},ur5:{links:[{x:0,y:0,z:.089159,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.425,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.39225,y:0,z:.10915,roll:0,pitch:0,yaw:0},{x:0,y:-.09465,z:-1941303950897609e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0823,z:-1688001216681175e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur10:{links:[{x:0,y:0,z:.1273,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.612,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.5723,y:0,z:.163941,roll:0,pitch:0,yaw:0},{x:0,y:-.1157,z:-2373046667922381e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0922,z:-1891053610911353e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur3e:{links:[{x:0,y:0,z:.15185,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.24355,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.2132,y:0,z:.13105,roll:0,pitch:0,yaw:0},{x:0,y:-.08535,z:-1750557762378351e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0921,z:-18890025766262e-24,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],null]},ur5e:{links:[{x:0,y:0,z:.1625,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.425,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.3922,y:0,z:.1333,roll:0,pitch:0,yaw:0},{x:0,y:-.0997,z:-2044881182297852e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0996,z:-2042830148012698e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur7e:{links:[{x:0,y:0,z:.1625,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.425,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.3922,y:0,z:.1333,roll:0,pitch:0,yaw:0},{x:0,y:-.0997,z:-2044881182297852e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.0996,z:-2042830148012698e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur10e:{links:[{x:0,y:0,z:.1807,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.6127,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.57155,y:0,z:.17415,roll:0,pitch:0,yaw:0},{x:0,y:-.11985,z:-2458164590756244e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.11655,z:-2390480459346185e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur12e:{links:[{x:0,y:0,z:.1807,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.6127,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.57155,y:0,z:.17415,roll:0,pitch:0,yaw:0},{x:0,y:-.11985,z:-2458164590756244e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.11655,z:-2390480459346185e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur16e:{links:[{x:0,y:0,z:.1807,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.4784,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.36,y:0,z:.17415,roll:0,pitch:0,yaw:0},{x:0,y:-.11985,z:-2458164590756244e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.11655,z:-2390480459346185e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur8long:{links:[{x:0,y:0,z:.2186,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.8989,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.7149,y:0,z:.1824,roll:0,pitch:0,yaw:0},{x:0,y:-.1361,z:-2791457662093657e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.1434,z:-2941183164909849e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur15:{links:[{x:0,y:0,z:.2186,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.6475,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.5164,y:0,z:.1824,roll:0,pitch:0,yaw:0},{x:0,y:-.1361,z:-2791457662093657e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.1434,z:-2941183164909849e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur18:{links:[{x:0,y:0,z:.2186,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.475,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.3389,y:0,z:.1824,roll:0,pitch:0,yaw:0},{x:0,y:-.1361,z:-2791457662093657e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.1434,z:-2941183164909849e-26,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur20:{links:[{x:0,y:0,z:.2363,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.862,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.7287,y:0,z:.201,roll:0,pitch:0,yaw:0},{x:0,y:-.1593,z:-3267297616249225e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.1543,z:-31647459019915597e-27,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]},ur30:{links:[{x:0,y:0,z:.2363,roll:0,pitch:0,yaw:0},{x:0,y:0,z:0,roll:1.570796327,pitch:0,yaw:0},{x:-.637,y:0,z:0,roll:0,pitch:0,yaw:0},{x:-.5037,y:0,z:.201,roll:0,pitch:0,yaw:0},{x:0,y:-.1593,z:-3267297616249225e-26,roll:1.570796327,pitch:0,yaw:0},{x:0,y:.1543,z:-31647459019915597e-27,roll:1.570796326589793,pitch:3.141592653589793,yaw:3.141592653589793}],jointLimits:[[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-3.141592654,3.141592654],[-6.283185307,6.283185307],[-6.283185307,6.283185307],[-6.283185307,6.283185307]]}};var lf={type:"change"},jc={type:"start"},uf={type:"end"},Ja=new Xn,cf=new ln,Py=Math.cos(70*Hr.DEG2RAD),Rt=new L,jt=2*Math.PI,ct={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},$c=1e-6,Qa=class extends Nr{constructor(e,t=null){super(e,t),this.state=ct.NONE,this.target=new L,this.cursor=new L,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:ui.ROTATE,MIDDLE:ui.DOLLY,RIGHT:ui.PAN},this.touches={ONE:hi.ROTATE,TWO:hi.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this._lastPosition=new L,this._lastQuaternion=new Gt,this._lastTargetPosition=new L,this._quat=new Gt().setFromUnitVectors(e.up,new L(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new Es,this._sphericalDelta=new Es,this._scale=1,this._panOffset=new L,this._rotateStart=new we,this._rotateEnd=new we,this._rotateDelta=new we,this._panStart=new we,this._panEnd=new we,this._panDelta=new we,this._dollyStart=new we,this._dollyEnd=new we,this._dollyDelta=new we,this._dollyDirection=new L,this._mouse=new we,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Dy.bind(this),this._onPointerDown=Ly.bind(this),this._onPointerUp=Ny.bind(this),this._onContextMenu=Hy.bind(this),this._onMouseWheel=Fy.bind(this),this._onKeyDown=By.bind(this),this._onTouchStart=zy.bind(this),this._onTouchMove=ky.bind(this),this._onMouseDown=Oy.bind(this),this._onMouseMove=Uy.bind(this),this._interceptControlDown=Vy.bind(this),this._interceptControlUp=Gy.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}connect(e){super.connect(e),this.domElement.addEventListener("pointerdown",this._onPointerDown),this.domElement.addEventListener("pointercancel",this._onPointerUp),this.domElement.addEventListener("contextmenu",this._onContextMenu),this.domElement.addEventListener("wheel",this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener("keydown",this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction="none"}disconnect(){this.domElement.removeEventListener("pointerdown",this._onPointerDown),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.domElement.removeEventListener("pointercancel",this._onPointerUp),this.domElement.removeEventListener("wheel",this._onMouseWheel),this.domElement.removeEventListener("contextmenu",this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener("keydown",this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction="auto"}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener("keydown",this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(lf),this.update(),this.state=ct.NONE}update(e=null){let t=this.object.position;Rt.copy(t).sub(this.target),Rt.applyQuaternion(this._quat),this._spherical.setFromVector3(Rt),this.autoRotate&&this.state===ct.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,s=this.maxAzimuthAngle;isFinite(n)&&isFinite(s)&&(n<-Math.PI?n+=jt:n>Math.PI&&(n-=jt),s<-Math.PI?s+=jt:s>Math.PI&&(s-=jt),n<=s?this._spherical.theta=Math.max(n,Math.min(s,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+s)/2?Math.max(n,this._spherical.theta):Math.min(s,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let r=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let o=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),r=o!=this._spherical.radius}if(Rt.setFromSpherical(this._spherical),Rt.applyQuaternion(this._quatInverse),t.copy(this.target).add(Rt),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let o=null;if(this.object.isPerspectiveCamera){let a=Rt.length();o=this._clampDistance(a*this._scale);let c=a-o;this.object.position.addScaledVector(this._dollyDirection,c),this.object.updateMatrixWorld(),r=!!c}else if(this.object.isOrthographicCamera){let a=new L(this._mouse.x,this._mouse.y,0);a.unproject(this.object);let c=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),r=c!==this.object.zoom;let l=new L(this._mouse.x,this._mouse.y,0);l.unproject(this.object),this.object.position.sub(l).add(a),this.object.updateMatrixWorld(),o=Rt.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),this.zoomToCursor=!1;o!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(o).add(this.object.position):(Ja.origin.copy(this.object.position),Ja.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(Ja.direction))<Py?this.object.lookAt(this.target):(cf.setFromNormalAndCoplanarPoint(this.object.up,this.target),Ja.intersectPlane(cf,this.target))))}else if(this.object.isOrthographicCamera){let o=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),o!==this.object.zoom&&(this.object.updateProjectionMatrix(),r=!0)}return this._scale=1,this._performCursorZoom=!1,r||this._lastPosition.distanceToSquared(this.object.position)>$c||8*(1-this._lastQuaternion.dot(this.object.quaternion))>$c||this._lastTargetPosition.distanceToSquared(this.target)>$c?(this.dispatchEvent(lf),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e!==null?jt/60*this.autoRotateSpeed*e:jt/60/60*this.autoRotateSpeed}_getZoomScale(e){let t=Math.abs(e*.01);return Math.pow(.95,this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){Rt.setFromMatrixColumn(t,0),Rt.multiplyScalar(-e),this._panOffset.add(Rt)}_panUp(e,t){this.screenSpacePanning===!0?Rt.setFromMatrixColumn(t,1):(Rt.setFromMatrixColumn(t,0),Rt.crossVectors(this.object.up,Rt)),Rt.multiplyScalar(e),this._panOffset.add(Rt)}_pan(e,t){let n=this.domElement;if(this.object.isPerspectiveCamera){let s=this.object.position;Rt.copy(s).sub(this.target);let r=Rt.length();r*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*r/n.clientHeight,this.object.matrix),this._panUp(2*t*r/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let n=this.domElement.getBoundingClientRect(),s=e-n.left,r=t-n.top,o=n.width,a=n.height;this._mouse.x=s/o*2-1,this._mouse.y=-(r/a)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(jt*this._rotateDelta.x/t.clientHeight),this._rotateUp(jt*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(jt*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(-jt*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(jt*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(-jt*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._rotateStart.set(n,s)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panStart.set(n,s)}}_handleTouchStartDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyStart.set(0,r)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{let n=this._getSecondPointerPosition(e),s=.5*(e.pageX+n.x),r=.5*(e.pageY+n.y);this._rotateEnd.set(s,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(jt*this._rotateDelta.x/t.clientHeight),this._rotateUp(jt*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),s=.5*(e.pageY+t.y);this._panEnd.set(n,s)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,s=e.pageY-t.y,r=Math.sqrt(n*n+s*s);this._dollyEnd.set(0,r),this._dollyDelta.set(0,Math.pow(this._dollyEnd.y/this._dollyStart.y,this.zoomSpeed)),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let o=(e.pageX+t.x)*.5,a=(e.pageY+t.y)*.5;this._updateZoomParameters(o,a)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new we,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){let t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){let t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100;break}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}};function Ly(i){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(i.pointerId),this.domElement.addEventListener("pointermove",this._onPointerMove),this.domElement.addEventListener("pointerup",this._onPointerUp)),!this._isTrackingPointer(i)&&(this._addPointer(i),i.pointerType==="touch"?this._onTouchStart(i):this._onMouseDown(i)))}function Dy(i){this.enabled!==!1&&(i.pointerType==="touch"?this._onTouchMove(i):this._onMouseMove(i))}function Ny(i){switch(this._removePointer(i),this._pointers.length){case 0:this.domElement.releasePointerCapture(i.pointerId),this.domElement.removeEventListener("pointermove",this._onPointerMove),this.domElement.removeEventListener("pointerup",this._onPointerUp),this.dispatchEvent(uf),this.state=ct.NONE;break;case 1:let e=this._pointers[0],t=this._pointerPositions[e];this._onTouchStart({pointerId:e,pageX:t.x,pageY:t.y});break}}function Oy(i){let e;switch(i.button){case 0:e=this.mouseButtons.LEFT;break;case 1:e=this.mouseButtons.MIDDLE;break;case 2:e=this.mouseButtons.RIGHT;break;default:e=-1}switch(e){case ui.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(i),this.state=ct.DOLLY;break;case ui.ROTATE:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=ct.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=ct.ROTATE}break;case ui.PAN:if(i.ctrlKey||i.metaKey||i.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(i),this.state=ct.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(i),this.state=ct.PAN}break;default:this.state=ct.NONE}this.state!==ct.NONE&&this.dispatchEvent(jc)}function Uy(i){switch(this.state){case ct.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(i);break;case ct.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(i);break;case ct.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(i);break}}function Fy(i){this.enabled===!1||this.enableZoom===!1||this.state!==ct.NONE||(i.preventDefault(),this.dispatchEvent(jc),this._handleMouseWheel(this._customWheelEvent(i)),this.dispatchEvent(uf))}function By(i){this.enabled!==!1&&this._handleKeyDown(i)}function zy(i){switch(this._trackPointer(i),this._pointers.length){case 1:switch(this.touches.ONE){case hi.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(i),this.state=ct.TOUCH_ROTATE;break;case hi.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(i),this.state=ct.TOUCH_PAN;break;default:this.state=ct.NONE}break;case 2:switch(this.touches.TWO){case hi.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(i),this.state=ct.TOUCH_DOLLY_PAN;break;case hi.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(i),this.state=ct.TOUCH_DOLLY_ROTATE;break;default:this.state=ct.NONE}break;default:this.state=ct.NONE}this.state!==ct.NONE&&this.dispatchEvent(jc)}function ky(i){switch(this._trackPointer(i),this.state){case ct.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(i),this.update();break;case ct.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(i),this.update();break;case ct.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(i),this.update();break;case ct.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(i),this.update();break;default:this.state=ct.NONE}}function Hy(i){this.enabled!==!1&&i.preventDefault()}function Vy(i){i.key==="Control"&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}function Gy(i){i.key==="Control"&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener("keyup",this._interceptControlUp,{passive:!0,capture:!0}))}var el=class extends Ai{constructor(){super();let e=new ai;e.deleteAttribute("uv");let t=new Yt({side:Et}),n=new Yt,s=new Li(16777215,900,28,2);s.position.set(.418,16.199,.3),this.add(s);let r=new Qe(e,t);r.position.set(-.757,13.219,.717),r.scale.set(31.713,28.305,28.591),this.add(r);let o=new Ri(e,n,6),a=new ht;a.position.set(-10.906,2.009,1.846),a.rotation.set(0,-.195,0),a.scale.set(2.328,7.905,4.651),a.updateMatrix(),o.setMatrixAt(0,a.matrix),a.position.set(-5.607,-.754,-.758),a.rotation.set(0,.994,0),a.scale.set(1.97,1.534,3.955),a.updateMatrix(),o.setMatrixAt(1,a.matrix),a.position.set(6.167,.857,7.803),a.rotation.set(0,.561,0),a.scale.set(3.927,6.285,3.687),a.updateMatrix(),o.setMatrixAt(2,a.matrix),a.position.set(-2.017,.018,6.124),a.rotation.set(0,.333,0),a.scale.set(2.002,4.566,2.064),a.updateMatrix(),o.setMatrixAt(3,a.matrix),a.position.set(2.291,-.756,-2.621),a.rotation.set(0,-.286,0),a.scale.set(1.546,1.552,1.496),a.updateMatrix(),o.setMatrixAt(4,a.matrix),a.position.set(-2.193,-.369,-5.547),a.rotation.set(0,.516,0),a.scale.set(3.875,3.487,2.986),a.updateMatrix(),o.setMatrixAt(5,a.matrix),this.add(o);let c=new Qe(e,Fs(50));c.position.set(-16.116,14.37,8.208),c.scale.set(.1,2.428,2.739),this.add(c);let l=new Qe(e,Fs(50));l.position.set(-16.109,18.021,-8.207),l.scale.set(.1,2.425,2.751),this.add(l);let u=new Qe(e,Fs(17));u.position.set(14.904,12.198,-1.832),u.scale.set(.15,4.265,6.331),this.add(u);let h=new Qe(e,Fs(43));h.position.set(-.462,8.89,14.52),h.scale.set(4.38,5.441,.088),this.add(h);let d=new Qe(e,Fs(20));d.position.set(3.235,11.486,-12.541),d.scale.set(2.5,2,.1),this.add(d);let p=new Qe(e,Fs(100));p.position.set(0,20,0),p.scale.set(1,.1,1),this.add(p)}dispose(){let e=new Set;this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))});for(let t of e)t.dispose()}};function Fs(i){return new br({color:0,emissive:16777215,emissiveIntensity:i})}var hf="data-ds-dark-theme";function tl(i=globalThis.document){let e=i?.body;return e==null||typeof e.hasAttribute!="function"?!1:e.hasAttribute(hf)===!0}var fi=Object.freeze({dark:Object.freeze({gridMajor:3359829,gridMinor:2241348,fallbackArm:8952234,trajectory:3526911}),light:Object.freeze({gridMajor:10135476,gridMinor:13029336,fallbackArm:7042949,trajectory:2060267})});function nl(i){return i?fi.dark:fi.light}function df(i,e=globalThis.document){let t=e?.body,n=globalThis.MutationObserver;if(t==null||typeof n!="function")return()=>{};let s=new n(()=>{try{i(tl(e))}catch{}});return s.observe(t,{attributes:!0,attributeFilter:[hf]}),()=>{try{s.disconnect()}catch{}}}function ff(i=2,e=20,t=fi.dark){let n=new Pr(i,e,t.gridMajor,t.gridMinor);return n.name="base_grid",n.rotation.x=Math.PI/2,n}var il=Object.freeze({fov:45,near:.01,far:100,position:Object.freeze([.8,-.8,.6])}),Kc=Object.freeze({ambientIntensity:.8,directionalIntensity:1.2,directionalPosition:Object.freeze([1,2,1])}),pf={iso:{label:"\u7B49\u8F74\u6D4B",direction:[1,-1,.8]},front:{label:"\u524D\u89C6",direction:[0,-1,0]},side:{label:"\u4FA7\u89C6",direction:[1,0,0]},top:{label:"\u4FEF\u89C6",direction:[.02,-.02,1]}},mf="iso",Zc=1.25;function Wy(i,e=45,t=1,n=Zc){let s=Number.isFinite(i)&&i>0?i:1,o=(Number.isFinite(e)&&e>0&&e<180?e:45)*Math.PI/180,a=s/Math.sin(o/2),c=Number.isFinite(t)&&t>0?t:1,l=2*Math.atan(Math.tan(o/2)*c),u=s/Math.sin(l/2),h=Number.isFinite(n)&&n>0?n:Zc;return Math.max(a,u)*h}function Xy(i){let t=(Number.isFinite(i)&&i>0?i:1)*2*1.5,n=Math.max(.5,Math.ceil(t*2)/2),s=Math.min(40,Math.max(8,Math.round(n/.1)));return{size:n,divisions:s}}function gf(i,{maxPixelRatio:e=2,rendererFactory:t,palette:n=fi.dark}={}){let s=n,r=typeof t=="function"?t(i):new Ka({canvas:i,antialias:!0,alpha:!0});r.toneMapping=oa,r.toneMappingExposure=1;let o=new Ai,a=null,c=null;try{c=new Os(r),a=c.fromScene(new el,.04),o.environment=a.texture}catch{a=null,c=null}let l=new vt(il.fov,1,il.near,il.far);l.up.set(0,0,1),l.position.set(...il.position);let u=ff(2,20,s);o.add(new Cr(16777215,Kc.ambientIntensity));let h=new Ni(16777215,Kc.directionalIntensity);h.position.set(...Kc.directionalPosition),o.add(h),o.add(u);let d=new Qa(l,i);d.enableDamping=!0,d.target.set(0,0,.3),d.minDistance=.15,d.maxDistance=6;let p=null,g=new Set;d.addEventListener?.("change",()=>{for(let E of g)try{E()}catch{}});function x(E){let{size:C,divisions:D}=Xy(E),S=s===fi.dark;if(!(u?.userData?.size===C&&u?.userData?.divisions===D&&u?.userData?.dark===S)){if(u){o.remove(u);try{u.geometry?.dispose?.(),u.material?.dispose?.()}catch{}}u=ff(C,D,s),u.userData.size=C,u.userData.divisions=D,u.userData.dark=S,o.add(u)}}function m(E){return E==null||E===s?!1:(s=E,x(p?.radius??0),!0)}function f(){let{clientWidth:E,clientHeight:C}=i;if(E===0||C===0)return!1;let D=Math.min(e,Math.max(1,typeof globalThis<"u"&&globalThis.devicePixelRatio||1));return r.setPixelRatio(D),r.setSize(E,C,!1),l.aspect=E/C,l.updateProjectionMatrix(),!0}function T(E,{padding:C=Zc}={}){if(!E)return!1;E.updateMatrixWorld?.(!0);let D=null;try{let P=new Wt().setFromObject(E);P.isEmpty()||(D=P.getBoundingSphere(new Ot))}catch{D=null}let S=D&&Number.isFinite(D.radius)&&D.radius>0?D.radius:.5;return p={center:D?D.center.clone():new L(0,0,.3),radius:S,padding:C},x(S),d.minDistance=S*.15,d.maxDistance=S*12,l.near=Math.max(.001,S/100),l.far=Math.max(10,S*100),l.updateProjectionMatrix(),b(mf)}function b(E){if(p===null)return!1;let C=pf[E]??pf[mf],D=new L(...C.direction).normalize(),S=Wy(p.radius,l.fov,l.aspect,p.padding);return d.target.copy(p.center),l.position.copy(p.center).addScaledVector(D,S),l.lookAt(p.center),d.update(),!0}function M(){d.update(),r.render(o,l)}function A(){d.dispose(),g.clear();try{u?.geometry?.dispose?.(),u?.material?.dispose?.()}catch{}u&&o.remove(u),u=null;try{a?.dispose?.(),c?.dispose?.()}catch{}a=null;try{r.forceContextLoss?.()}catch{}r.dispose()}return{renderer:r,scene:o,camera:l,controls:d,get grid(){return u},currentFitRadius(){return p?.radius??0},resize:f,render:M,fitTo:T,setViewPreset:b,applyTheme:m,onCameraChange(E){g.add(E)},dispose:A}}var Bs=.08,Yy=.12,qy=.03,$y=.3,_f=Object.freeze([Object.freeze({text:"X",color:16725587}),Object.freeze({text:"Y",color:9240374}),Object.freeze({text:"Z",color:3580671})]);function xf(i){return!Number.isFinite(i)||i<=0?Bs:Math.min($y,Math.max(qy,i*Yy))}function jy(i,e){try{let t=document.createElement("canvas");t.width=64,t.height=64;let n=t.getContext("2d");if(!n)return null;n.font="bold 44px sans-serif",n.textAlign="center",n.textBaseline="middle",n.lineWidth=6,n.strokeStyle="rgba(8, 12, 16, 0.9)",n.strokeText(i,32,34),n.fillStyle=`#${new Pe(e).getHexString()}`,n.fillText(i,32,34);let s=new xr(t);return s.needsUpdate=!0,s}catch{return null}}function Jc(i=Bs){let e=new St;e.name="ur-twin-tcp-axes";let t=new St;t.name="ur-twin-tcp-axes-content",e.add(t);let n=new Dr(i);n.name="ur-twin-tcp-axes-lines",t.add(n);let s=new St;s.name="ur-twin-tcp-axes-labels";let r=[];for(let o=0;o<_f.length;o++){let{text:a,color:c}=_f[o],l=jy(a,c);if(l===null)continue;let u=new vs({map:l,transparent:!0,depthTest:!1}),h=new dr(u),d=i*1.12;h.position.set(o===0?d:0,o===1?d:0,o===2?d:0),h.scale.setScalar(i*.45),h.name=`ur-twin-tcp-axis-${a.toLowerCase()}`,s.add(h),r.push(h)}return t.add(s),e.userData.content=t,e.userData.axes=n,e.userData.labels=r,e}function yf(i,e){let t=Bs,n=Number.isFinite(e)&&e>0?e/t:1;i?.userData?.content?.scale?.setScalar?.(n)}function vf(i){i?.traverse?.(e=>{e.geometry?.dispose?.();let t=e.material;if(Array.isArray(t))for(let n of t)n?.map?.dispose?.(),n?.dispose?.();else t&&(t.map?.dispose?.(),t.dispose?.())})}function Qc(i,e){if(e===Tc)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),i;if(e===Ps||e===kr){let t=i.getIndex();if(t===null){let o=[],a=i.getAttribute("position");if(a!==void 0){for(let c=0;c<a.count;c++)o.push(c);i.setIndex(o),t=i.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),i}let n=t.count-2,s=[];if(e===Ps)for(let o=1;o<=n;o++)s.push(t.getX(0)),s.push(t.getX(o)),s.push(t.getX(o+1));else for(let o=0;o<n;o++)o%2===0?(s.push(t.getX(o)),s.push(t.getX(o+1)),s.push(t.getX(o+2))):(s.push(t.getX(o+2)),s.push(t.getX(o+1)),s.push(t.getX(o)));s.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");let r=i.clone();return r.setIndex(s),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),i}var sl=class extends Dn{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new ou(t)}),this.register(function(t){return new au(t)}),this.register(function(t){return new gu(t)}),this.register(function(t){return new _u(t)}),this.register(function(t){return new xu(t)}),this.register(function(t){return new cu(t)}),this.register(function(t){return new uu(t)}),this.register(function(t){return new hu(t)}),this.register(function(t){return new du(t)}),this.register(function(t){return new ru(t)}),this.register(function(t){return new fu(t)}),this.register(function(t){return new lu(t)}),this.register(function(t){return new mu(t)}),this.register(function(t){return new pu(t)}),this.register(function(t){return new iu(t)}),this.register(function(t){return new yu(t)}),this.register(function(t){return new vu(t)})}load(e,t,n,s){let r=this,o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){let l=jn.extractUrlBase(e);o=jn.resolveURL(l,this.path)}else o=jn.extractUrlBase(e);this.manager.itemStart(e);let a=function(l){s?s(l):console.error(l),r.manager.itemError(e),r.manager.itemEnd(e)},c=new Ts(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{r.parse(l,o,function(u){t(u),r.manager.itemEnd(e)},a)}catch(u){a(u)}},n,a)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,s){let r,o={},a={},c=new TextDecoder;if(typeof e=="string")r=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===Ef){try{o[$e.KHR_BINARY_GLTF]=new Su(e)}catch(h){s&&s(h);return}r=JSON.parse(o[$e.KHR_BINARY_GLTF].content)}else r=JSON.parse(c.decode(e));else r=e;if(r.asset===void 0||r.asset.version[0]<2){s&&s(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}let l=new Ru(r,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let u=0;u<this.pluginCallbacks.length;u++){let h=this.pluginCallbacks[u](l);h.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[h.name]=h,o[h.name]=!0}if(r.extensionsUsed)for(let u=0;u<r.extensionsUsed.length;++u){let h=r.extensionsUsed[u],d=r.extensionsRequired||[];switch(h){case $e.KHR_MATERIALS_UNLIT:o[h]=new su;break;case $e.KHR_DRACO_MESH_COMPRESSION:o[h]=new Mu(r,this.dracoLoader);break;case $e.KHR_TEXTURE_TRANSFORM:o[h]=new bu;break;case $e.KHR_MESH_QUANTIZATION:o[h]=new Tu;break;default:d.indexOf(h)>=0&&a[h]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+h+'".')}}l.setExtensions(o),l.setPlugins(a),l.parse(n,s)}parseAsync(e,t){let n=this;return new Promise(function(s,r){n.parse(e,t,s,r)})}};function Ky(){let i={};return{get:function(e){return i[e]},add:function(e,t){i[e]=t},remove:function(e){delete i[e]},removeAll:function(){i={}}}}var $e={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"},iu=class{constructor(e){this.parser=e,this.name=$e.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,s=t.length;n<s;n++){let r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n="light:"+e,s=t.cache.get(n);if(s)return s;let r=t.json,c=((r.extensions&&r.extensions[this.name]||{}).lights||[])[e],l,u=new Pe(16777215);c.color!==void 0&&u.setRGB(c.color[0],c.color[1],c.color[2],Lt);let h=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new Ni(u),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new Li(u),l.distance=h;break;case"spot":l=new Rr(u),l.distance=h,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),Un(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),s=Promise.resolve(l),t.cache.add(n,s),s}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,r=n.json.nodes[e],a=(r.extensions&&r.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(c){return n._getNodeRef(t.cache,a,c)})}},su=class{constructor(){this.name=$e.KHR_MATERIALS_UNLIT}getMaterialType(){return Ft}extendParams(e,t,n){let s=[];e.color=new Pe(1,1,1),e.opacity=1;let r=t.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){let o=r.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],Lt),e.opacity=o[3]}r.baseColorTexture!==void 0&&s.push(n.assignTexture(e,"map",r.baseColorTexture,bt))}return Promise.all(s)}},ru=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let s=this.parser.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=s.extensions[this.name].emissiveStrength;return r!==void 0&&(t.emissiveIntensity=r),Promise.resolve()}},ou=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(r.push(n.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){let a=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new we(a,a)}return Promise.all(r)}},au=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_DISPERSION}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let s=this.parser.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=s.extensions[this.name];return t.dispersion=r.dispersion!==void 0?r.dispersion:0,Promise.resolve()}},lu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(r)}},cu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_SHEEN}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[];t.sheenColor=new Pe(0,0,0),t.sheenRoughness=0,t.sheen=1;let o=s.extensions[this.name];if(o.sheenColorFactor!==void 0){let a=o.sheenColorFactor;t.sheenColor.setRGB(a[0],a[1],a[2],Lt)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&r.push(n.assignTexture(t,"sheenColorMap",o.sheenColorTexture,bt)),o.sheenRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(r)}},uu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&r.push(n.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(r)}},hu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_VOLUME}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&r.push(n.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;let a=o.attenuationColor||[1,1,1];return t.attenuationColor=new Pe().setRGB(a[0],a[1],a[2],Lt),Promise.all(r)}},du=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_IOR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let s=this.parser.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=s.extensions[this.name];return t.ior=r.ior!==void 0?r.ior:1.5,Promise.resolve()}},fu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_SPECULAR}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&r.push(n.assignTexture(t,"specularIntensityMap",o.specularTexture));let a=o.specularColorFactor||[1,1,1];return t.specularColor=new Pe().setRGB(a[0],a[1],a[2],Lt),o.specularColorTexture!==void 0&&r.push(n.assignTexture(t,"specularColorMap",o.specularColorTexture,bt)),Promise.all(r)}},pu=class{constructor(e){this.parser=e,this.name=$e.EXT_MATERIALS_BUMP}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&r.push(n.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(r)}},mu=class{constructor(e){this.parser=e,this.name=$e.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){let n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:qt}extendMaterialParams(e,t){let n=this.parser,s=n.json.materials[e];if(!s.extensions||!s.extensions[this.name])return Promise.resolve();let r=[],o=s.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&r.push(n.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(r)}},gu=class{constructor(e){this.parser=e,this.name=$e.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,s=n.textures[e];if(!s.extensions||!s.extensions[this.name])return null;let r=s.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,r.source,o)}},_u=class{constructor(e){this.parser=e,this.name=$e.EXT_TEXTURE_WEBP}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let o=r.extensions[t],a=s.images[o.source],c=n.textureLoader;if(a.uri){let l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return n.loadTextureImage(e,o.source,c)}},xu=class{constructor(e){this.parser=e,this.name=$e.EXT_TEXTURE_AVIF}loadTexture(e){let t=this.name,n=this.parser,s=n.json,r=s.textures[e];if(!r.extensions||!r.extensions[t])return null;let o=r.extensions[t],a=s.images[o.source],c=n.textureLoader;if(a.uri){let l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return n.loadTextureImage(e,o.source,c)}},yu=class{constructor(e){this.name=$e.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let s=n.extensions[this.name],r=this.parser.getDependency("buffer",s.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(a){let c=s.byteOffset||0,l=s.byteLength||0,u=s.count,h=s.byteStride,d=new Uint8Array(a,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(u,h,d,s.mode,s.filter).then(function(p){return p.buffer}):o.ready.then(function(){let p=new ArrayBuffer(u*h);return o.decodeGltfBuffer(new Uint8Array(p),u,h,d,s.mode,s.filter),p})})}else return null}},vu=class{constructor(e){this.name=$e.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let s=t.meshes[n.mesh];for(let l of s.primitives)if(l.mode!==hn.TRIANGLES&&l.mode!==hn.TRIANGLE_STRIP&&l.mode!==hn.TRIANGLE_FAN&&l.mode!==void 0)return null;let o=n.extensions[this.name].attributes,a=[],c={};for(let l in o)a.push(this.parser.getDependency("accessor",o[l]).then(u=>(c[l]=u,c[l])));return a.length<1?null:(a.push(this.parser.createNodeMesh(e)),Promise.all(a).then(l=>{let u=l.pop(),h=u.isGroup?u.children:[u],d=l[0].count,p=[];for(let g of h){let x=new Ve,m=new L,f=new Gt,T=new L(1,1,1),b=new Ri(g.geometry,g.material,d);for(let M=0;M<d;M++)c.TRANSLATION&&m.fromBufferAttribute(c.TRANSLATION,M),c.ROTATION&&f.fromBufferAttribute(c.ROTATION,M),c.SCALE&&T.fromBufferAttribute(c.SCALE,M),b.setMatrixAt(M,x.compose(m,f,T));for(let M in c)if(M==="_COLOR_0"){let A=c[M];b.instanceColor=new ci(A.array,A.itemSize,A.normalized)}else M!=="TRANSLATION"&&M!=="ROTATION"&&M!=="SCALE"&&g.geometry.setAttribute(M,c[M]);ht.prototype.copy.call(b,g),this.parser.assignFinalMaterial(b),p.push(b)}return u.isGroup?(u.clear(),u.add(...p),u):p[0]}))}},Ef="glTF",Gr=12,Sf={JSON:1313821514,BIN:5130562},Su=class{constructor(e){this.name=$e.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,Gr),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==Ef)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");let s=this.header.length-Gr,r=new DataView(e,Gr),o=0;for(;o<s;){let a=r.getUint32(o,!0);o+=4;let c=r.getUint32(o,!0);if(o+=4,c===Sf.JSON){let l=new Uint8Array(e,Gr+o,a);this.content=n.decode(l)}else if(c===Sf.BIN){let l=Gr+o;this.body=e.slice(l,l+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}},Mu=class{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=$e.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,s=this.dracoLoader,r=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,a={},c={},l={};for(let u in o){let h=Au[u]||u.toLowerCase();a[h]=o[u]}for(let u in e.attributes){let h=Au[u]||u.toLowerCase();if(o[u]!==void 0){let d=n.accessors[e.attributes[u]],p=zs[d.componentType];l[h]=p.name,c[h]=d.normalized===!0}}return t.getDependency("bufferView",r).then(function(u){return new Promise(function(h,d){s.decodeDracoFile(u,function(p){for(let g in p.attributes){let x=p.attributes[g],m=c[g];m!==void 0&&(x.normalized=m)}h(p)},a,l,Lt,d)})})}},bu=class{constructor(){this.name=$e.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}},Tu=class{constructor(){this.name=$e.KHR_MESH_QUANTIZATION}},rl=class extends Yn{constructor(e,t,n,s){super(e,t,n,s)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,s=this.valueSize,r=e*s*3+s;for(let o=0;o!==s;o++)t[o]=n[r+o];return t}interpolate_(e,t,n,s){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=a*2,l=a*3,u=s-t,h=(n-t)/u,d=h*h,p=d*h,g=e*l,x=g-l,m=-2*p+3*d,f=p-d,T=1-m,b=f-d+h;for(let M=0;M!==a;M++){let A=o[x+M+a],E=o[x+M+c]*u,C=o[g+M+a],D=o[g+M]*u;r[M]=T*A+b*E+m*C+f*D}return r}},Zy=new Gt,Eu=class extends rl{interpolate_(e,t,n,s){let r=super.interpolate_(e,t,n,s);return Zy.fromArray(r).normalize().toArray(r),r}},hn={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},zs={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Mf={9728:Pt,9729:Vt,9984:ca,9985:As,9986:Fi,9987:Sn},bf={33071:En,33648:ps,10497:oi},eu={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Au={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},pi={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},Jy={CUBICSPLINE:void 0,LINEAR:Ti,STEP:bi},tu={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Qy(i){return i.DefaultMaterial===void 0&&(i.DefaultMaterial=new Yt({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:xn})),i.DefaultMaterial}function Gi(i,e,t){for(let n in t.extensions)i[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function Un(i,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(i.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function ev(i,e,t){let n=!1,s=!1,r=!1;for(let l=0,u=e.length;l<u;l++){let h=e[l];if(h.POSITION!==void 0&&(n=!0),h.NORMAL!==void 0&&(s=!0),h.COLOR_0!==void 0&&(r=!0),n&&s&&r)break}if(!n&&!s&&!r)return Promise.resolve(i);let o=[],a=[],c=[];for(let l=0,u=e.length;l<u;l++){let h=e[l];if(n){let d=h.POSITION!==void 0?t.getDependency("accessor",h.POSITION):i.attributes.position;o.push(d)}if(s){let d=h.NORMAL!==void 0?t.getDependency("accessor",h.NORMAL):i.attributes.normal;a.push(d)}if(r){let d=h.COLOR_0!==void 0?t.getDependency("accessor",h.COLOR_0):i.attributes.color;c.push(d)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c)]).then(function(l){let u=l[0],h=l[1],d=l[2];return n&&(i.morphAttributes.position=u),s&&(i.morphAttributes.normal=h),r&&(i.morphAttributes.color=d),i.morphTargetsRelative=!0,i})}function tv(i,e){if(i.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)i.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){let t=e.extras.targetNames;if(i.morphTargetInfluences.length===t.length){i.morphTargetDictionary={};for(let n=0,s=t.length;n<s;n++)i.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function nv(i){let e,t=i.extensions&&i.extensions[$e.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+nu(t.attributes):e=i.indices+":"+nu(i.attributes)+":"+i.mode,i.targets!==void 0)for(let n=0,s=i.targets.length;n<s;n++)e+=":"+nu(i.targets[n]);return e}function nu(i){let e="",t=Object.keys(i).sort();for(let n=0,s=t.length;n<s;n++)e+=t[n]+":"+i[t[n]]+";";return e}function wu(i){switch(i){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function iv(i){return i.search(/\.jpe?g($|\?)/i)>0||i.search(/^data\:image\/jpeg/)===0?"image/jpeg":i.search(/\.webp($|\?)/i)>0||i.search(/^data\:image\/webp/)===0?"image/webp":i.search(/\.ktx2($|\?)/i)>0||i.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}var sv=new Ve,Ru=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new Ky,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,s=-1,r=!1,o=-1;if(typeof navigator<"u"){let a=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(a)===!0;let c=a.match(/Version\/(\d+)/);s=n&&c?parseInt(c[1],10):-1,r=a.indexOf("Firefox")>-1,o=r?a.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&s<17||r&&o<98?this.textureLoader=new Ar(this.options.manager):this.textureLoader=new Ir(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new Ts(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,s=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(o){let a={scene:o[0][s.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:s.asset,parser:n,userData:{}};return Gi(r,a,s),Un(a,s),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(a)})).then(function(){for(let c of a.scenes)c.updateMatrixWorld();e(a)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let s=0,r=t.length;s<r;s++){let o=t[s].joints;for(let a=0,c=o.length;a<c;a++)e[o[a]].isBone=!0}for(let s=0,r=e.length;s<r;s++){let o=e[s];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(n[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let s=n.clone(),r=(o,a)=>{let c=this.associations.get(o);c!=null&&this.associations.set(a,c);for(let[l,u]of o.children.entries())r(u,a.children[l])};return r(n,s),s.name+="_instance_"+e.uses[t]++,s}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let s=e(t[n]);if(s)return s}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let s=0;s<t.length;s++){let r=e(t[s]);r&&n.push(r)}return n}getDependency(e,t){let n=e+":"+t,s=this.cache.get(n);if(!s){switch(e){case"scene":s=this.loadScene(t);break;case"node":s=this._invokeOne(function(r){return r.loadNode&&r.loadNode(t)});break;case"mesh":s=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(t)});break;case"accessor":s=this.loadAccessor(t);break;case"bufferView":s=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(t)});break;case"buffer":s=this.loadBuffer(t);break;case"material":s=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(t)});break;case"texture":s=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(t)});break;case"skin":s=this.loadSkin(t);break;case"animation":s=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(t)});break;case"camera":s=this.loadCamera(t);break;default:if(s=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(e,t)}),!s)throw new Error("Unknown type: "+e);break}this.cache.add(n,s)}return s}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,s=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(s.map(function(r,o){return n.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[$e.KHR_BINARY_GLTF].body);let s=this.options;return new Promise(function(r,o){n.load(jn.resolveURL(t.uri,s.path),r,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){let s=t.byteLength||0,r=t.byteOffset||0;return n.slice(r,r+s)})}loadAccessor(e){let t=this,n=this.json,s=this.json.accessors[e];if(s.bufferView===void 0&&s.sparse===void 0){let o=eu[s.type],a=zs[s.componentType],c=s.normalized===!0,l=new a(s.count*o);return Promise.resolve(new Mt(l,o,c))}let r=[];return s.bufferView!==void 0?r.push(this.getDependency("bufferView",s.bufferView)):r.push(null),s.sparse!==void 0&&(r.push(this.getDependency("bufferView",s.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",s.sparse.values.bufferView))),Promise.all(r).then(function(o){let a=o[0],c=eu[s.type],l=zs[s.componentType],u=l.BYTES_PER_ELEMENT,h=u*c,d=s.byteOffset||0,p=s.bufferView!==void 0?n.bufferViews[s.bufferView].byteStride:void 0,g=s.normalized===!0,x,m;if(p&&p!==h){let f=Math.floor(d/p),T="InterleavedBuffer:"+s.bufferView+":"+s.componentType+":"+f+":"+s.count,b=t.cache.get(T);b||(x=new l(a,f*p,s.count*p/u),b=new wi(x,p/u),t.cache.add(T,b)),m=new li(b,c,d%p/u,g)}else a===null?x=new l(s.count*c):x=new l(a,d,s.count*c),m=new Mt(x,c,g);if(s.sparse!==void 0){let f=eu.SCALAR,T=zs[s.sparse.indices.componentType],b=s.sparse.indices.byteOffset||0,M=s.sparse.values.byteOffset||0,A=new T(o[1],b,s.sparse.count*f),E=new l(o[2],M,s.sparse.count*c);a!==null&&(m=new Mt(m.array.slice(),m.itemSize,m.normalized)),m.normalized=!1;for(let C=0,D=A.length;C<D;C++){let S=A[C];if(m.setX(S,E[C*c]),c>=2&&m.setY(S,E[C*c+1]),c>=3&&m.setZ(S,E[C*c+2]),c>=4&&m.setW(S,E[C*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}m.normalized=g}return m})}loadTexture(e){let t=this.json,n=this.options,r=t.textures[e].source,o=t.images[r],a=this.textureLoader;if(o.uri){let c=n.manager.getHandler(o.uri);c!==null&&(a=c)}return this.loadTextureImage(e,r,a)}loadTextureImage(e,t,n){let s=this,r=this.json,o=r.textures[e],a=r.images[t],c=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];let l=this.loadImageSource(t,n).then(function(u){u.flipY=!1,u.name=o.name||a.name||"",u.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(u.name=a.uri);let d=(r.samplers||{})[o.sampler]||{};return u.magFilter=Mf[d.magFilter]||Vt,u.minFilter=Mf[d.minFilter]||Sn,u.wrapS=bf[d.wrapS]||oi,u.wrapT=bf[d.wrapT]||oi,u.generateMipmaps=!u.isCompressedTexture&&u.minFilter!==Pt&&u.minFilter!==Vt,s.associations.set(u,{textures:e}),u}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){let n=this,s=this.json,r=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(h=>h.clone());let o=s.images[e],a=self.URL||self.webkitURL,c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=n.getDependency("bufferView",o.bufferView).then(function(h){l=!0;let d=new Blob([h],{type:o.mimeType});return c=a.createObjectURL(d),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");let u=Promise.resolve(c).then(function(h){return new Promise(function(d,p){let g=d;t.isImageBitmapLoader===!0&&(g=function(x){let m=new Tt(x);m.needsUpdate=!0,d(m)}),t.load(jn.resolveURL(h,r.path),g,void 0,p)})}).then(function(h){return l===!0&&a.revokeObjectURL(c),Un(h,o),h.userData.mimeType=o.mimeType||iv(o.uri),h}).catch(function(h){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),h});return this.sourceCache[e]=u,u}assignTexture(e,t,n,s){let r=this;return this.getDependency("texture",n.index).then(function(o){if(!o)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(o=o.clone(),o.channel=n.texCoord),r.extensions[$e.KHR_TEXTURE_TRANSFORM]){let a=n.extensions!==void 0?n.extensions[$e.KHR_TEXTURE_TRANSFORM]:void 0;if(a){let c=r.associations.get(o);o=r.extensions[$e.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),r.associations.set(o,c)}}return s!==void 0&&(o.colorSpace=s),e[t]=o,o})}assignFinalMaterial(e){let t=e.geometry,n=e.material,s=t.attributes.tangent===void 0,r=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){let a="PointsMaterial:"+n.uuid,c=this.cache.get(a);c||(c=new bs,Ut.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(a,c)),n=c}else if(e.isLine){let a="LineBasicMaterial:"+n.uuid,c=this.cache.get(a);c||(c=new vn,Ut.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(a,c)),n=c}if(s||r||o){let a="ClonedMaterial:"+n.uuid+":";s&&(a+="derivative-tangents:"),r&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let c=this.cache.get(a);c||(c=n.clone(),r&&(c.vertexColors=!0),o&&(c.flatShading=!0),s&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(a,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return Yt}loadMaterial(e){let t=this,n=this.json,s=this.extensions,r=n.materials[e],o,a={},c=r.extensions||{},l=[];if(c[$e.KHR_MATERIALS_UNLIT]){let h=s[$e.KHR_MATERIALS_UNLIT];o=h.getMaterialType(),l.push(h.extendParams(a,r,t))}else{let h=r.pbrMetallicRoughness||{};if(a.color=new Pe(1,1,1),a.opacity=1,Array.isArray(h.baseColorFactor)){let d=h.baseColorFactor;a.color.setRGB(d[0],d[1],d[2],Lt),a.opacity=d[3]}h.baseColorTexture!==void 0&&l.push(t.assignTexture(a,"map",h.baseColorTexture,bt)),a.metalness=h.metallicFactor!==void 0?h.metallicFactor:1,a.roughness=h.roughnessFactor!==void 0?h.roughnessFactor:1,h.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(a,"metalnessMap",h.metallicRoughnessTexture)),l.push(t.assignTexture(a,"roughnessMap",h.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,a)})))}r.doubleSided===!0&&(a.side=Bt);let u=r.alphaMode||tu.OPAQUE;if(u===tu.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,u===tu.MASK&&(a.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&o!==Ft&&(l.push(t.assignTexture(a,"normalMap",r.normalTexture)),a.normalScale=new we(1,1),r.normalTexture.scale!==void 0)){let h=r.normalTexture.scale;a.normalScale.set(h,h)}if(r.occlusionTexture!==void 0&&o!==Ft&&(l.push(t.assignTexture(a,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&o!==Ft){let h=r.emissiveFactor;a.emissive=new Pe().setRGB(h[0],h[1],h[2],Lt)}return r.emissiveTexture!==void 0&&o!==Ft&&l.push(t.assignTexture(a,"emissiveMap",r.emissiveTexture,bt)),Promise.all(l).then(function(){let h=new o(a);return r.name&&(h.name=r.name),Un(h,r),t.associations.set(h,{materials:e}),r.extensions&&Gi(s,h,r),h})}createUniqueName(e){let t=ut.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,s=this.primitiveCache;function r(a){return n[$e.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,t).then(function(c){return Tf(c,a,t)})}let o=[];for(let a=0,c=e.length;a<c;a++){let l=e[a],u=nv(l),h=s[u];if(h)o.push(h.promise);else{let d;l.extensions&&l.extensions[$e.KHR_DRACO_MESH_COMPRESSION]?d=r(l):d=Tf(new _t,l,t),s[u]={primitive:l,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(e){let t=this,n=this.json,s=this.extensions,r=n.meshes[e],o=r.primitives,a=[];for(let c=0,l=o.length;c<l;c++){let u=o[c].material===void 0?Qy(this.cache):this.getDependency("material",o[c].material);a.push(u)}return a.push(t.loadGeometries(o)),Promise.all(a).then(function(c){let l=c.slice(0,c.length-1),u=c[c.length-1],h=[];for(let p=0,g=u.length;p<g;p++){let x=u[p],m=o[p],f,T=l[p];if(m.mode===hn.TRIANGLES||m.mode===hn.TRIANGLE_STRIP||m.mode===hn.TRIANGLE_FAN||m.mode===void 0)f=r.isSkinnedMesh===!0?new fr(x,T):new Qe(x,T),f.isSkinnedMesh===!0&&f.normalizeSkinWeights(),m.mode===hn.TRIANGLE_STRIP?f.geometry=Qc(f.geometry,kr):m.mode===hn.TRIANGLE_FAN&&(f.geometry=Qc(f.geometry,Ps));else if(m.mode===hn.LINES)f=new Ci(x,T);else if(m.mode===hn.LINE_STRIP)f=new Cn(x,T);else if(m.mode===hn.LINE_LOOP)f=new gr(x,T);else if(m.mode===hn.POINTS)f=new _r(x,T);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+m.mode);Object.keys(f.geometry.morphAttributes).length>0&&tv(f,r),f.name=t.createUniqueName(r.name||"mesh_"+e),Un(f,r),m.extensions&&Gi(s,f,m),t.assignFinalMaterial(f),h.push(f)}for(let p=0,g=h.length;p<g;p++)t.associations.set(h[p],{meshes:e,primitives:p});if(h.length===1)return r.extensions&&Gi(s,h[0],r),h[0];let d=new St;r.extensions&&Gi(s,d,r),t.associations.set(d,{meshes:e});for(let p=0,g=h.length;p<g;p++)d.add(h[p]);return d})}loadCamera(e){let t,n=this.json.cameras[e],s=n[n.type];if(!s){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new vt(Hr.radToDeg(s.yfov),s.aspectRatio||1,s.znear||1,s.zfar||2e6):n.type==="orthographic"&&(t=new Di(-s.xmag,s.xmag,s.ymag,-s.ymag,s.znear,s.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),Un(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let s=0,r=t.joints.length;s<r;s++)n.push(this._loadNodeShallow(t.joints[s]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(s){let r=s.pop(),o=s,a=[],c=[];for(let l=0,u=o.length;l<u;l++){let h=o[l];if(h){a.push(h);let d=new Ve;r!==null&&d.fromArray(r.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new mr(a,c)})}loadAnimation(e){let t=this.json,n=this,s=t.animations[e],r=s.name?s.name:"animation_"+e,o=[],a=[],c=[],l=[],u=[];for(let h=0,d=s.channels.length;h<d;h++){let p=s.channels[h],g=s.samplers[p.sampler],x=p.target,m=x.node,f=s.parameters!==void 0?s.parameters[g.input]:g.input,T=s.parameters!==void 0?s.parameters[g.output]:g.output;x.node!==void 0&&(o.push(this.getDependency("node",m)),a.push(this.getDependency("accessor",f)),c.push(this.getDependency("accessor",T)),l.push(g),u.push(x))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(l),Promise.all(u)]).then(function(h){let d=h[0],p=h[1],g=h[2],x=h[3],m=h[4],f=[];for(let b=0,M=d.length;b<M;b++){let A=d[b],E=p[b],C=g[b],D=x[b],S=m[b];if(A===void 0)continue;A.updateMatrix&&A.updateMatrix();let y=n._createAnimationTracks(A,E,C,D,S);if(y)for(let P=0;P<y.length;P++)f.push(y[P])}let T=new Er(r,void 0,f);return Un(T,s),T})}createNodeMesh(e){let t=this.json,n=this,s=t.nodes[e];return s.mesh===void 0?null:n.getDependency("mesh",s.mesh).then(function(r){let o=n._getNodeRef(n.meshCache,s.mesh,r);return s.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let c=0,l=s.weights.length;c<l;c++)a.morphTargetInfluences[c]=s.weights[c]}),o})}loadNode(e){let t=this.json,n=this,s=t.nodes[e],r=n._loadNodeShallow(e),o=[],a=s.children||[];for(let l=0,u=a.length;l<u;l++)o.push(n.getDependency("node",a[l]));let c=s.skin===void 0?Promise.resolve(null):n.getDependency("skin",s.skin);return Promise.all([r,Promise.all(o),c]).then(function(l){let u=l[0],h=l[1],d=l[2];d!==null&&u.traverse(function(p){p.isSkinnedMesh&&p.bind(d,sv)});for(let p=0,g=h.length;p<g;p++)u.add(h[p]);return u})}_loadNodeShallow(e){let t=this.json,n=this.extensions,s=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let r=t.nodes[e],o=r.name?s.createUniqueName(r.name):"",a=[],c=s._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&a.push(c),r.camera!==void 0&&a.push(s.getDependency("camera",r.camera).then(function(l){return s._getNodeRef(s.cameraCache,r.camera,l)})),s._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){a.push(l)}),this.nodeCache[e]=Promise.all(a).then(function(l){let u;if(r.isBone===!0?u=new Ss:l.length>1?u=new St:l.length===1?u=l[0]:u=new ht,u!==l[0])for(let h=0,d=l.length;h<d;h++)u.add(l[h]);if(r.name&&(u.userData.name=r.name,u.name=o),Un(u,r),r.extensions&&Gi(n,u,r),r.matrix!==void 0){let h=new Ve;h.fromArray(r.matrix),u.applyMatrix4(h)}else r.translation!==void 0&&u.position.fromArray(r.translation),r.rotation!==void 0&&u.quaternion.fromArray(r.rotation),r.scale!==void 0&&u.scale.fromArray(r.scale);if(!s.associations.has(u))s.associations.set(u,{});else if(r.mesh!==void 0&&s.meshCache.refs[r.mesh]>1){let h=s.associations.get(u);s.associations.set(u,{...h})}return s.associations.get(u).nodes=e,u}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],s=this,r=new St;n.name&&(r.name=s.createUniqueName(n.name)),Un(r,n),n.extensions&&Gi(t,r,n);let o=n.nodes||[],a=[];for(let c=0,l=o.length;c<l;c++)a.push(s.getDependency("node",o[c]));return Promise.all(a).then(function(c){for(let u=0,h=c.length;u<h;u++)r.add(c[u]);let l=u=>{let h=new Map;for(let[d,p]of s.associations)(d instanceof Ut||d instanceof Tt)&&h.set(d,p);return u.traverse(d=>{let p=s.associations.get(d);p!=null&&h.set(d,p)}),h};return s.associations=l(r),r})}_createAnimationTracks(e,t,n,s,r){let o=[],a=e.name?e.name:e.uuid,c=[];pi[r.path]===pi.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(a);let l;switch(pi[r.path]){case pi.weights:l=In;break;case pi.rotation:l=Pn;break;case pi.translation:case pi.scale:l=Ln;break;default:switch(n.itemSize){case 1:l=In;break;case 2:case 3:default:l=Ln;break}break}let u=s.interpolation!==void 0?Jy[s.interpolation]:Ti,h=this._getArrayFromAccessor(n);for(let d=0,p=c.length;d<p;d++){let g=new l(c[d]+"."+pi[r.path],t.array,h,u);s.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(g),o.push(g)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let n=wu(t.constructor),s=new Float32Array(t.length);for(let r=0,o=t.length;r<o;r++)s[r]=t[r]*n;t=s}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){let s=this instanceof Pn?Eu:rl;return new s(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}};function rv(i,e,t){let n=e.attributes,s=new Wt;if(n.POSITION!==void 0){let a=t.json.accessors[n.POSITION],c=a.min,l=a.max;if(c!==void 0&&l!==void 0){if(s.set(new L(c[0],c[1],c[2]),new L(l[0],l[1],l[2])),a.normalized){let u=wu(zs[a.componentType]);s.min.multiplyScalar(u),s.max.multiplyScalar(u)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;let r=e.targets;if(r!==void 0){let a=new L,c=new L;for(let l=0,u=r.length;l<u;l++){let h=r[l];if(h.POSITION!==void 0){let d=t.json.accessors[h.POSITION],p=d.min,g=d.max;if(p!==void 0&&g!==void 0){if(c.setX(Math.max(Math.abs(p[0]),Math.abs(g[0]))),c.setY(Math.max(Math.abs(p[1]),Math.abs(g[1]))),c.setZ(Math.max(Math.abs(p[2]),Math.abs(g[2]))),d.normalized){let x=wu(zs[d.componentType]);c.multiplyScalar(x)}a.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}s.expandByVector(a)}i.boundingBox=s;let o=new Ot;s.getCenter(o.center),o.radius=s.min.distanceTo(s.max)/2,i.boundingSphere=o}function Tf(i,e,t){let n=e.attributes,s=[];function r(o,a){return t.getDependency("accessor",o).then(function(c){i.setAttribute(a,c)})}for(let o in n){let a=Au[o]||o.toLowerCase();a in i.attributes||s.push(r(n[o],a))}if(e.indices!==void 0&&!i.index){let o=t.getDependency("accessor",e.indices).then(function(a){i.setIndex(a)});s.push(o)}return Ke.workingColorSpace!==Lt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Ke.workingColorSpace}" not supported.`),Un(i,e),rv(i,e,t),Promise.all(s).then(function(){return e.targets!==void 0?ev(i,e.targets,t):i})}var Wr=["base","shoulder","upperarm","forearm","wrist1","wrist2","wrist3"],Rf=[.15,.12,.24,.21,.085,.092,.092],ol=new Map,Af=null;async function ov(i){return Af??=new sl,await Af.loadAsync(i)}function av(i){let e=[];for(let t=0;t<7;t++){let n=new St;n.name=`assemble_${Wr[t]}`,n.matrixAutoUpdate=!1,e.push(n)}for(let t=1;t<7;t++)e[0].add(e[t]);for(let t=0;t<7;t++){let n=i?.getObjectByName?.(Wr[t]);n&&e[t].add(n)}return i?.add?.(e[0]),e}function lv(i){let e=[];for(let t=0;t<7;t++){let n=Array.isArray(i)?i[t]:void 0;e.push(Number.isFinite(n)&&n>0?n:Rf[t])}return e}function cv(i){if(i!==null&&typeof i=="object"&&!Array.isArray(i)){let{x:e=0,y:t=0,z:n=0}=i;return[e,t,n].every(Number.isFinite)?[e,t,n]:null}if(Array.isArray(i)&&i.length>=12){let[e,t,n]=[i[3],i[7],i[11]];return[e,t,n].every(Number.isFinite)?[e,t,n]:null}return null}function uv(i,e){return Math.hypot(e[0]-i[0],e[1]-i[1],e[2]-i[2])}function al(i){if(!Array.isArray(i)||i.length===0)return null;let e=[];for(let s of i){let r=cv(s);if(r===null)return null;e.push(r)}let t=i.every(s=>s!==null&&typeof s=="object"&&!Array.isArray(s)),n;if(t){if(e.length<6)return null;n=e.map(([s,r,o])=>Math.hypot(s,r,o))}else{if(e.length<7)return null;n=[];for(let s=0;s<6;s++)n.push(uv(e[s],e[s+1]))}if(n.length===0||n.some(s=>!Number.isFinite(s)))return null;for(;n.length<7;)n.push(n[n.length-1]);return n.slice(0,7)}function hv(i=Rf,e=fi.dark.fallbackArm){let t=lv(i),n=new St;n.name="fallback_arm";let s=new Yt({color:e,roughness:.6,metalness:.1});for(let r=0;r<7;r++){let o=Math.max(.04,t[r]*.8),a=new Qe(new Sr(Math.max(.03,t[r]*.18),o),s);a.name=Wr[r],a.position.z=t[r]*.5,n.add(a)}return n}async function Cf(i,e={}){let t=String(i??"").toLowerCase(),n=ol.get(t);if(n)return n.refs+=1,wf(n);let s=typeof e.loadGltf=="function"?e.loadGltf:ov,r,o=!1;try{let u=(await s(`${ku}?model=${encodeURIComponent(t)}`))?.scene;if(!u||typeof u.traverse!="function")throw new Error("GLB \u7ED3\u679C\u7F3A\u5C11 scene");r=u}catch{r=hv(e.armLinks,e.fallbackColor),o=!0}let a=av(r),c={id:t,refs:1,root:r,groups:a,usedFallback:o,applyFK(l){Cu(a,l)}};return ol.set(t,c),wf(c)}function Cu(i,e){let t=e?.links;if(!(!Array.isArray(t)||!Array.isArray(i))){i[0]&&(i[0].matrix.identity(),i[0].matrixWorldNeedsUpdate=!0);for(let n=1;n<7;n++){let s=t[n-1];i[n]&&Array.isArray(s)&&(i[n].matrix.fromArray(s),i[n].matrixWorldNeedsUpdate=!0)}}}function wf(i){let e=!1;return{root:i.root,groups:i.groups,usedFallback:i.usedFallback,applyFK:i.applyFK,dispose(){e||(e=!0,i.refs-=1,!(i.refs>0)&&(dv(i.root),ol.get(i.id)===i&&ol.delete(i.id)))}}}function dv(i){i?.traverse?.(e=>{e.geometry?.dispose?.();let t=Array.isArray(e.material)?e.material:e.material?[e.material]:[];for(let n of t){for(let s of Object.keys(n))n[s]?.dispose?.();n.dispose?.()}}),i?.parent?.remove?.(i)}var If=5949690,fv=.28,pv=16754263;function Pf(i,e={}){let t=i?.root;if(!t||typeof t.clone!="function")throw new Error("createGhostArm: \u9700\u8981\u4E00\u4E2A\u542B root \u7684\u6A21\u578B\u53E5\u67C4");let n=t.clone(!0);n.name="ur-twin-ghost-arm";let s=new Yt({color:e.color??If,transparent:!0,opacity:e.opacity??fv,depthWrite:!1,side:Bt,roughness:.5,metalness:.05});n.traverse?.(o=>{o.isMesh&&(o.material=s)});let r=[];for(let o=0;o<7;o++)r.push(n.getObjectByName?.(`assemble_${Wr[o]}`)??null);return n.visible=!1,{root:n,groups:r,material:s,applyFK(o){Cu(r,o)},setVisible(o){n.visible=o===!0},setPending(o){let a=e.color??If;s.color.setHex(o===!0?pv:a)}}}function Iu(i){i!=null&&(i.root?.parent?.remove?.(i.root),i.material?.dispose?.())}var Lf=4030118,mv=16765286,Pu=.1,gv=.002,_v=.6,xv=1;function Df(i){let e=al(i);if(e===null)return null;let t=e.slice(0,6).reduce((n,s)=>n+(Number.isFinite(s)?s:0),0);return t>0?t:null}function yv(i,e={}){if(!Array.isArray(i)||i.length<3)return null;let[t,n,s]=i;if(!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(s))return null;let r=Math.hypot(t,n,s),o=Number.isFinite(e.deadzoneN)?e.deadzoneN:xv;if(!(r>o))return null;let a=Number.isFinite(e.metersPerNewton)?e.metersPerNewton:gv,c=Number.isFinite(e.maxLength)?e.maxLength:_v,l=Math.min(c,r*a);return{direction:[t/r,n/r,s/r],length:l}}function Nf(i){let e=new St;e.name="ur-twin-reach-sphere";let t=Number.isFinite(i)&&i>0?i:1,n=new Qe(new Ii(t,32,20),new Ft({color:Lf,transparent:!0,opacity:.06,side:Et,depthWrite:!1}));n.name="ur-twin-reach-shell",e.add(n);let s=new Qe(new Ii(t,16,10),new Ft({color:Lf,transparent:!0,opacity:.18,wireframe:!0,depthWrite:!1,side:Bt}));return s.name="ur-twin-reach-wire",e.add(s),e.visible=!1,e}function Of(i=.03){let e=Number.isFinite(i)&&i>0?i:.03,t=new Qe(new Ii(e/2,16,12),new Ft({color:mv,depthTest:!1}));return t.name="ur-twin-cog-marker",t.visible=!1,t}function Uf(i){let e=new Lr(new L(0,0,1),new L(0,0,0),Pu,16777215,Pu*.25,Pu*.15);return e.name="ur-twin-force-arrow",e.visible=!1,Lu(e,i),e}function Lu(i,e,t){if(i==null)return;let n=yv(e,t);if(n===null){i.visible=!1;return}i.setDirection(new L(...n.direction)),i.setLength(n.length,n.length*.25,n.length*.15),i.visible=!0}function Ff(i){i!=null&&(i.traverse?.(e=>{e.geometry?.dispose?.();let t=e.material;if(Array.isArray(t))for(let n of t)n?.dispose?.();else t?.dispose?.()}),i.parent?.remove?.(i))}function vv(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}function Bf(i,e){let t=new Array(16);for(let n=0;n<4;n++)for(let s=0;s<4;s++)t[n*4+s]=i[s]*e[n*4]+i[4+s]*e[n*4+1]+i[8+s]*e[n*4+2]+i[12+s]*e[n*4+3];return t}function Sv(i){let e=Math.cos(i),t=Math.sin(i);return[e,t,0,0,-t,e,0,0,0,0,1,0,0,0,0,1]}function Mv(i,e,t,n,s,r){let o=Math.cos(n),a=Math.sin(n),c=Math.cos(s),l=Math.sin(s),u=Math.cos(r),h=Math.sin(r);return[u*c,h*c,-l,0,u*l*a-h*o,h*l*a+u*o,c*a,0,u*l*o+h*a,h*l*o-u*a,c*o,0,i,e,t,1]}function Du(i,e){let t=[],n=vv();for(let s=0;s<6;s++){let r=i.links[s];n=Bf(n,Mv(r.x??0,r.y??0,r.z??0,r.roll??0,r.pitch??0,r.yaw??0)),n=Bf(n,Sv(e?.[s]??0)),t.push(n.slice())}return{links:t,tool0:n.slice()}}function bv(i,e,t){return i.map((n,s)=>n+(e[s]-n)*t)}function zf(i,e,t){let n=e.ts-i.ts;if(!(n>0))return e.q.slice();let s=Math.min(1,Math.max(0,(t-i.ts)/n));return bv(i.q,e.q,s)}function kf(i,e,t){return[...i,e].filter(s=>e.ts-s.ts<=t)}function Hf(i){return i.map(e=>[e.tcp[0],e.tcp[1],e.tcp[2]])}var Tv=Object.freeze([.12,.28,.45]),Ev=Object.freeze([.35,.78,1]);function Vf(i,e={}){if(!Array.isArray(i)||i.length===0)return[];let t=Array.isArray(e.oldColor)?e.oldColor:Tv,n=Array.isArray(e.newColor)?e.newColor:Ev,r=i.map(l=>Number.isFinite(l?.ts)?l.ts:null).filter(l=>l!==null),o=r.length>0?Math.max(...r):null,a=r.length>0?Math.min(...r):null,c=o!==null&&a!==null?o-a:0;return i.map((l,u)=>{let h;return c>0&&Number.isFinite(l?.ts)?h=(l.ts-a)/c:h=i.length<=1?1:u/(i.length-1),h=Math.min(1,Math.max(0,h)),[t[0]+(n[0]-t[0])*h,t[1]+(n[1]-t[1])*h,t[2]+(n[2]-t[2])*h]})}var Av="ts,tcp_x,tcp_y,tcp_z,j1,j2,j3,j4,j5,j6";function Gf(i){let e=[Av];if(!Array.isArray(i))return e.join(`
`);let t=n=>Number.isFinite(n)?n.toFixed(6):"";for(let n of i){let s=Array.isArray(n?.tcp)?n.tcp:[],r=Array.isArray(n?.q)?n.q:[],o=[t(n?.ts),t(s[0]),t(s[1]),t(s[2]),t(r[0]),t(r[1]),t(r[2]),t(r[3]),t(r[4]),t(r[5])];e.push(o.join(","))}return e.join(`
`)}var Wf="dsh-ur-twin-styles",wv="data-dsh-ur-twin-style",Rv=`
.ur-twin-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 25%, var(--dsw-alias-bg-layer-1, #161b22) 0%, var(--dsw-alias-bg-base, #0b0f14) 72%);
  color: var(--dsw-alias-label-primary, #c9d1d9);
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
}
.ur-twin-view {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
/*
 * \u89C6\u89D2\u5DE5\u5177\u680F\u3002\u4EE5\u524D\u9762\u677F\u91CC\u552F\u4E00\u7684\u63A7\u4EF6\u662F\u4E00\u4E2A\u753B\u5E03 \u2014\u2014 OrbitControls \u5141\u8BB8\u628A\u76F8\u673A\u63A8\u8FDB\u673A\u68B0\u81C2\u5185\u90E8\u6216
 * \u63A8\u5230\u770B\u4E0D\u89C1\u7684\u5730\u65B9\uFF0C\u800C"\u91CD\u7F6E"\u53EA\u80FD\u9760\u6536\u8D77\u9762\u677F\u518D\u5C55\u5F00\u3002\u8FD9\u6392\u6309\u94AE\u8865\u4E0A\u90A3\u4E2A\u7F3A\u53E3\u3002
 */
.ur-twin-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #21262d);
  background: var(--dsw-alias-bg-layer-2, rgba(13, 17, 23, 0.72));
}
.ur-twin-toolbar-button {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2, #30363d);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, #161b22);
  color: var(--dsw-alias-label-primary, #c9d1d9);
  font: inherit;
  cursor: pointer;
}
.ur-twin-toolbar-button:hover {
  border-color: var(--dsw-alias-state-business-primary, #58a6ff);
  color: var(--dsw-alias-state-business-primary, #58a6ff);
}
.ur-twin-toolbar-button:active { background: var(--dsw-alias-interactive-bg-active, #21262d); }
.ur-twin-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}
.ur-twin-hud {
  flex: 0 0 auto;
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, #21262d);
  background: var(--dsw-alias-bg-layer-2, rgba(13, 17, 23, 0.72));
}
.ur-twin-hud-row {
  overflow: hidden;
  white-space: pre;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-tertiary, #8b949e);
}
.ur-twin-status {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, #21262d);
  color: var(--dsw-alias-label-tertiary, #8b949e);
}
.ur-twin-error {
  flex: 0 0 auto;
  padding: 0 10px 6px;
  color: var(--dsw-alias-state-error-primary, #f85149);
  white-space: pre-wrap;
}
.ur-twin-panel[data-ur-twin-connected='true'] .ur-twin-status { color: var(--dsw-alias-state-success-primary, #3fb950); }
/* \u5B89\u5168\u72B6\u6001\u5F02\u5E38\u65F6\u538B\u8FC7\u4E0A\u9762\u90A3\u6761\u7EFF\u8272\uFF1A\u540C\u7B49\u7279\u5F02\u6027\uFF0C\u9760**\u5199\u5728\u540E\u9762**\u53D6\u80DC\uFF0C\u4E0D\u8981\u4E0A\u79FB\u8FD9\u4E24\u6761\u3002 */
.ur-twin-panel[data-ur-twin-hazard='true'] .ur-twin-status { color: var(--dsw-alias-state-error-primary, #f85149); }
.ur-twin-hud-row[data-ur-twin-hazard='true'] { color: var(--dsw-alias-state-error-primary, #f85149); }
/* \u5173\u8282\u8D85\u51FA kinematics.json \u7684\u9650\u4F4D\uFF1A\u548C"\u5B89\u5168\u5F02\u5E38"\u7528\u540C\u4E00\u4E2A\u8B66\u793A\u8272\uFF0C\u4F46\u53EA\u67D3\u90A3\u4E00\u884C\u3002 */
.ur-twin-hud-row[data-ur-twin-overlimit='true'] { color: var(--dsw-alias-state-error-primary, #f85149); }
/* \u5F85\u5BA1\u6279\u7684\u8FD0\u52A8\u76EE\u6807\uFF1A\u4E0E\u5E7D\u7075\u81C2\u7684"\u5F85\u5BA1\u6279"\u6A59\u8272\u4E00\u81F4\uFF0C\u8BA9 HUD \u6587\u5B57\u4E0E 3D \u91CC\u7684\u5047\u81C2\u5BF9\u5F97\u4E0A\u3002
   \u7A7A\u7684\u65F6\u5019\uFF08\u6CA1\u6709\u5BA1\u6279\uFF09\u8FD9\u4E00\u884C\u4E0D\u67D3\u8272\uFF0C\u4E5F\u5C31\u770B\u4E0D\u51FA\u5360\u4F4D\u3002 */
.ur-twin-hud-row[data-ur-twin-pending]:not(:empty) { color: var(--dsw-alias-state-warn-primary, #ffa657); }
/* \u5DE5\u7A0B\u8F85\u52A9\u56FE\u5C42\u7684\u5F00\u5173\uFF08\u6E05\u5355\u7B2C 9 \u6761\uFF09\uFF1A\u514B\u5236\u7684\u5C0F\u6309\u94AE\uFF0C\u6FC0\u6D3B\u6001\u7528\u5B9E\u5FC3\u84DD\uFF0C\u4E00\u773C\u770B\u51FA\u54EA\u4E9B\u56FE\u5C42\u5F00\u7740\u3002 */
.ur-twin-layer-toggle {
  margin-right: 6px;
  padding: 1px 6px;
  font: inherit;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #8b949e);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, #30363d);
  border-radius: 4px;
  cursor: pointer;
}
.ur-twin-layer-toggle[aria-pressed='true'] {
  color: var(--dsw-alias-label-primary-foreground, #0d1117);
  background: var(--dsw-alias-state-business-primary, #58a6ff);
  border-color: var(--dsw-alias-state-business-primary, #58a6ff);
}
/* \u8EAB\u4EFD\u884C\uFF08\u673A\u578B + IP\uFF09\u6BD4\u8BFB\u6570\u66F4\u91CD\u8981\uFF0C\u7ED9\u5B83\u6B63\u5E38\u524D\u666F\u8272\u800C\u4E0D\u662F\u6CE8\u91CA\u7070\u3002 */
.ur-twin-hud-row[data-ur-twin-identity] { color: var(--dsw-alias-label-primary, #c9d1d9); }
/* \u6570\u636E\u901A\u9053\u5065\u5EB7\u5EA6\uFF080.6.6\uFF09\uFF1A\u505C\u6EDE/\u91CD\u8FDE\u5FC5\u987B\u4E00\u773C\u53EF\u89C1 \u2014\u2014 \u753B\u9762\u505C\u4F4F\u65F6\u7528\u6237\u8981\u80FD\u5206\u6E05
   "\u673A\u5668\u4EBA\u505C\u4E86"\u4E0E"\u6570\u636E\u505C\u4E86"\uFF0C\u6240\u4EE5\u8FD9\u4E00\u884C\u7528\u8B66\u793A\u8272\uFF08\u9EC4=\u505C\u6EDE/\u91CD\u8FDE\u4E2D\uFF0C\u7EA2=\u901A\u9053\u4E0D\u53EF\u7528\uFF09\u3002 */
.ur-twin-hud-row[data-ur-twin-feed-state='stale'] { color: var(--dsw-alias-state-warn-primary, #d29922); }
.ur-twin-hud-row[data-ur-twin-feed-state='retrying'] { color: var(--dsw-alias-state-warn-primary, #d29922); }
`.trim();function Xf(i=globalThis.document){if(!i||typeof i.createElement!="function")return null;let e=typeof i.getElementById=="function"?i.getElementById(Wf):null;if(e)return e;let t=i.createElement("style");return t.id=Wf,typeof t.setAttribute=="function"&&t.setAttribute(wv,""),t.textContent=Rv,(i.head??i.documentElement??i.body??null)?.appendChild?.(t),t}function Yf(i){let e=n=>String(n).padStart(2,"0"),t=i instanceof Date&&!Number.isNaN(i.getTime())?i:new Date(0);return`${t.getFullYear()}-${e(t.getMonth()+1)}-${e(t.getDate())} ${e(t.getHours())}:${e(t.getMinutes())}:${e(t.getSeconds())}`}function Nu(i,e){let n=(typeof i?.model=="string"&&i.model.trim()!==""?i.model.trim():"robot").replace(/[^A-Za-z0-9._-]+/gu,"-"),s=Yf(e).replace(/[: ]/gu,"-");return`ur-twin-${n}-${s}.png`}function Cv(i,e){let t=[],n=typeof i?.model=="string"&&i.model!==""?i.model:"\u672A\u77E5\u578B\u53F7",s=typeof i?.ip=="string"&&i.ip!==""?i.ip:"\u672A\u6307\u5B9A IP";t.push(`${n}  \xB7  ${s}`);let r=i?.detail;if(r!==null&&typeof r=="object"){let c=[];typeof r.safety_mode=="string"&&r.safety_mode!==""&&c.push(`\u5B89\u5168 ${r.safety_mode}`),typeof r.robot_mode=="string"&&r.robot_mode!==""&&c.push(`\u6A21\u5F0F ${r.robot_mode}`),Number.isFinite(r.speed_scaling)&&c.push(`\u500D\u7387 ${(r.speed_scaling*100).toFixed(0)}%`),c.length>0&&t.push(c.join("  \xB7  "))}let o=i?.q;Array.isArray(o)&&o.length>=6&&o.every(Number.isFinite)&&t.push(o.map((c,l)=>`J${l+1} ${(c*180/Math.PI).toFixed(1)}\xB0`).join("  "));let a=i?.tcp;return Array.isArray(a)&&a.length>=3&&a.slice(0,3).every(Number.isFinite)&&t.push(`TCP [${a[0].toFixed(3)}, ${a[1].toFixed(3)}, ${a[2].toFixed(3)}] m`),t.push(Yf(e)),t}function Iv(i,e,t){if(i==null||!Array.isArray(e)||e.length===0)return;let n=Number.isFinite(t?.padding)?t.padding:16,s=Number.isFinite(t?.lineHeight)?t.lineHeight:22,r=Number.isFinite(t?.height)?t.height:0,o=Number.isFinite(t?.width)?t.width:0;i.save?.(),i.fillStyle="rgba(8, 12, 16, 0.62)";let a=e.length*s+n*.6;i.fillRect?.(0,r-a,o,a),i.font=`${Math.round(s*.6)}px sans-serif`,i.fillStyle="#e6edf3",i.textBaseline="bottom";for(let c=0;c<e.length;c++){let l=r-n-c*s;i.fillText?.(e[c],n,l)}i.restore?.()}function qf(i,e,t={}){let n=t.document??globalThis.document;if(n==null||i==null||typeof n.createElement!="function")return null;try{let s=n.createElement("canvas");s.width=i.width,s.height=i.height;let r=s.getContext?.("2d");return r==null?null:(r.drawImage(i,0,0),Iv(r,Cv(e,t.now??new Date),{width:s.width,height:s.height,...t.lineHeight===void 0?{}:{lineHeight:t.lineHeight},...t.padding===void 0?{}:{padding:t.padding}}),s.toDataURL("image/png"))}catch{return null}}function Ou(i,e,t={}){let n=t.document??globalThis.document;if(n==null||typeof i!="string"||i==="")return!1;try{let s=n.createElement("a");return s.href=i,s.download=e,s.rel="noopener",s.click?.(),!0}catch{return!1}}var Be=Tn(),Xr=600,Pv=6e4,Lv=100,Dv=2500,Nv=1e4,Ov=1e4;var $f=0,Uv=400;var Fv="\u672A\u8FDE\u63A5\u673A\u5668\u4EBA",Bv="\u5DF2\u8FDE\u63A5 \xB7 \u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u2026",ll="\u5DF2\u8FDE\u63A5",zv="\uFF08\u65E0\u5185\u7F6E\u6A21\u578B\uFF0C\u4F7F\u7528\u8FD1\u4F3C\u51E0\u4F55\u4F53\uFF09",kv="\u6E32\u67D3\u5F02\u5E38\uFF1A",Hv="\u6A21\u578B\u52A0\u8F7D\u5931\u8D25\uFF1A",Vv="\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 WebGL\uFF1A\u5DF2\u5207\u6362\u4E3A\u7EAF\u6570\u503C\u6A21\u5F0F\uFF08\u5173\u8282\u89D2\u4E0E TCP \u4ECD\u4F1A\u66F4\u65B0\uFF09",Gv="\u673A\u5668\u4EBA\u672A\u8FD4\u56DE\u5B8C\u6574\u7684\u5173\u8282\u89D2",Wv="3D \u4E0A\u4E0B\u6587\u4E22\u5931\uFF08GPU \u91CD\u7F6E\uFF09\u2014\u2014 \u6536\u8D77\u5E76\u91CD\u65B0\u5C55\u5F00\u9762\u677F\u53EF\u6062\u590D",Xv="\u673A\u5668\u4EBA\u53EF\u80FD\u5DF2\u505C\u6B62\uFF0C\u8BF7\u68C0\u67E5\u793A\u6559\u5668";function Yv(i,e,t){switch(i){case"no_robot":return Be.disconnectNeverConnected;case"robot_not_connected":return Be.disconnectReason(e);case"ambiguous_robot":return Be.disconnectAmbiguous(Be.disconnectCandidates(t));case"worker_unavailable":return Be.disconnectWorkerDown(e);case"robot_error":return Be.disconnectReadFailed(e);default:return e?Be.disconnectReason(e):Be.statusDisconnected}}var qv=af,$v="ur3";function Uu(i){let e=qv??{},t=String(i??"").trim().toLowerCase();return e[t]??e[$v]??Object.values(e)[0]??null}function jf(i){let e=[];for(let t=0;t<6;t++){let n=i?.[t],s=Number.isFinite(n)?n*180/Math.PI:null;e.push(`J${t+1} ${s===null?"--":s.toFixed(1)}`)}return`${Be.jointsPrefix}  ${e.join("  ")}`}function jv(i,e){if(i==null||e==null)return[];let t=[],n=Math.min(i.length??0,e.length??0);for(let s=0;s<n;s++){let r=e[s],o=i[s];if(!Array.isArray(r)||!Number.isFinite(o))continue;let[a,c]=r;!Number.isFinite(a)||!Number.isFinite(c)||a>c||(o<a||o>c)&&t.push(s+1)}return t}function Kv(i){let t=["x","y","z","rx","ry","rz"].map((n,s)=>{let r=i?.[s];return Number.isFinite(r)?`${n} ${r.toFixed(s<3?4:3)}`:`${n} --`});return`${Be.tcpPrefix}  ${t.join("  ")}`}var Zv=eo("safetyMode"),Jv=eo("robotMode"),Qv=eo("programState"),eS="<\u67E5\u8BE2\u5931\u8D25>";function Bu(i,e){let t=typeof i=="string"?i.trim():"";return t===""?"--":t===eS?Be.queryFailed:e[t]??t}function tS(i={}){let e=typeof i.status=="string"?i.status:"",t=Number.isFinite(i.frames)?i.frames:0,n=Number.isFinite(i.frameErrors)?i.frameErrors:0,s=Be.feedFrames(t,n);if(e==="unsupported")return`${Be.feedNoEventSource}\uFF1A${Be.feedStale}${s}`;if(e==="retrying"||e==="connecting")return`${Be.feedRetrying}${s}`;let r=Number.isFinite(i.ageMs)?Math.max(0,i.ageMs):0;return i.feedStale===!0||r>Dv?i.connected!==!0?"":`${Be.feedStale} ${(r/1e3).toFixed(1)}s \xB7 ${Be.feedRetryWord}${s}`:""}var Zf=i=>Bu(i,Zv),nS=i=>Bu(i,Jv),iS=i=>Bu(i,Qv);function Fu(i){if(typeof i!="string")return!1;let e=i.trim().toUpperCase();return e===""?!1:e!=="NORMAL"&&e!=="REDUCED"}function sS(i){let e=typeof i=="number"?i:Number(i);return Number.isFinite(e)?`x${e.toFixed(2)}`:"--"}function rS(i,e,t=0,n=""){if(!Array.isArray(i)||i.length===0)return`${e}  --`;let s=[];for(let r=0;r<i.length;r++){let o=i[r];s.push(`J${r+1} ${Number.isFinite(o)?o.toFixed(t)+n:"--"}`)}return`${e}  ${s.join("  ")}`}function oS(i){let e=i&&typeof i=="object"?i:null;if(e===null||typeof e.error=="string")return{status:e?.error?Be.detailStatusFailed(e.error):"",temps:"",power:"",hazard:!1};let t=[Be.detailSafety(Zf(e.safety_mode)),Be.detailRobotMode(nS(e.robot_mode)),Be.detailProgram(iS(e.program_state)),Be.detailSpeed(sS(e.speed_scaling))];return e.running===!0&&t.push(Be.detailRunning),{status:t.join("  "),temps:rS(e.joint_temperatures,Be.detailTempsPrefix),power:Number.isFinite(Number(e.robot_voltage))&&Number.isFinite(Number(e.robot_current))?Be.detailBus(Number(e.robot_voltage).toFixed(1),Number(e.robot_current).toFixed(2)):"",hazard:Fu(e.safety_mode)}}var aS=[{key:"reset",label:Be.viewReset},{key:"iso",label:Be.viewIso},{key:"front",label:Be.viewFront},{key:"side",label:Be.viewSide},{key:"top",label:Be.viewTop}];function Kf(i,e){let t=e?.ts-i?.ts;return Number.isFinite(t)?Math.min(Uv,Math.max($f,t)):$f}function xt(i,e,t,n){let s=i.createElement(e);return t&&(s.className=t),n&&s.setAttribute(n,""),s}function cl(i,e){e&&(typeof i?.remove=="function"?i.remove(e):e.parent?.remove?.(e))}function Jf({container:i,state:e,sceneFactory:t=gf,modelLoader:n=Cf,raf:s=globalThis.requestAnimationFrame,caf:r=globalThis.cancelAnimationFrame,now:o=()=>performance.now()}={}){if(!i||typeof i.appendChild!="function")throw new TypeError("mountTwinPanel: \u9700\u8981\u4E00\u4E2A\u53EF\u7528\u7684 container \u5143\u7D20");let a=i.ownerDocument??globalThis.document;if(!a||typeof a.createElement!="function")throw new TypeError("mountTwinPanel: \u9700\u8981\u53EF\u7528\u7684 DOM\uFF08container.ownerDocument \u6216 globalThis.document\uFF09");Xf(a);let c=!1,l=null,u=null,h=null,d="",p="",g=0,x=[],m=0,f=null,T=null,b=!1,M=null,A=null,E=null,C=null,D=!1,S=-1/0,y=!1,P=!1,F=!1,k="",H=!1,q=!1,W=null,te=null,V=-1/0,oe=null,ce=!0,Te=-1/0,re=a.hidden===!0,ae=xt(a,"div","ur-twin-panel","data-ur-twin-panel");ae.setAttribute("data-ur-twin-connected","false");let Oe=xt(a,"div","ur-twin-view","data-ur-twin-view"),Re=xt(a,"canvas","ur-twin-canvas","data-ur-twin-canvas");Re.setAttribute("role","img"),Re.setAttribute("aria-label",Be.canvasLabel),Re.setAttribute("tabindex","0"),Re.addEventListener("keydown",_=>{let w=_?.key,U=w==="ArrowUp"?"top":w==="ArrowDown"?"iso":w==="ArrowLeft"?"side":w==="ArrowRight"?"front":w==="Home"?"reset":null;U!==null&&(_.preventDefault?.(),nn(U))}),Oe.appendChild(Re);let G=xt(a,"div","ur-twin-hud","data-ur-twin-hud");G.setAttribute("role","status"),G.setAttribute("aria-live","polite"),G.setAttribute("aria-label",Be.hudLabel);let K=xt(a,"div","ur-twin-hud-row","data-ur-twin-robots"),de=xt(a,"div","ur-twin-hud-row","data-ur-twin-pending"),Ce=xt(a,"div","ur-twin-hud-row","data-ur-twin-feed");Ce.style.display="none";let _e=xt(a,"div","ur-twin-hud-row","data-ur-twin-identity"),He=xt(a,"div","ur-twin-hud-row","data-ur-twin-joints"),pt=xt(a,"div","ur-twin-hud-row","data-ur-twin-tcp"),I=xt(a,"div","ur-twin-hud-row","data-ur-twin-detail"),et=xt(a,"div","ur-twin-hud-row","data-ur-twin-power");G.appendChild(K),G.appendChild(Ce),G.appendChild(de),G.appendChild(_e);let Ue=xt(a,"div","ur-twin-hud-row","data-ur-twin-layers");for(let[_,w]of[["reach",Be.layerReach],["base",Be.layerBase],["force",Be.layerForce]]){let U=xt(a,"button","ur-twin-layer-toggle",`data-ur-twin-layer-${_}`);U.type="button",U.textContent=w,U.setAttribute("aria-pressed","false"),U.addEventListener("click",()=>{X[_]=!X[_],U.setAttribute("aria-pressed",X[_]?"true":"false"),Ee(),Ye()}),Ue.appendChild(U)}G.appendChild(Ue);let Le=xt(a,"button","ur-twin-layer-toggle","data-ur-twin-screenshot");Le.type="button",Le.textContent=Be.screenshot,Le.setAttribute("aria-label",Be.screenshotLabel),Le.addEventListener("click",()=>{st();let _=u?.renderer?.domElement??Re,w=qf(_,T,{document:a});w!==null&&Ou(w,Nu(T,new Date),{document:a})}),Ue.appendChild(Le);let ye=(_,w,U)=>{let B=xt(a,"button","ur-twin-layer-toggle",`data-ur-twin-trajectory-${w}`);return B.type="button",B.textContent=_,B.setAttribute("aria-pressed","false"),B.addEventListener("click",()=>{U(B),Ye()}),Ue.appendChild(B),B};ye(Be.trajectoryClear,"clear",()=>{x=[],ge.setDrawRange(0,0)}),ye(Be.trajectoryPause,"pause",_=>{b=!b,_.setAttribute("aria-pressed",b?"true":"false"),_.textContent=b?Be.trajectoryResume:Be.trajectoryPause}),ye(Be.trajectoryExport,"export",()=>{let _=Gf(x),w=`data:text/csv;charset=utf-8,${encodeURIComponent(_)}`;Ou(w,`ur-twin-trajectory-${Nu(T,new Date).replace(/^ur-twin-|\.png$/gu,"")}.csv`,{document:a})}),G.appendChild(He),G.appendChild(pt),G.appendChild(I),G.appendChild(et);let dt=[de,_e,Ue,He,pt,I,et],xe=xt(a,"div","ur-twin-toolbar","data-ur-twin-toolbar");for(let _ of aS){let w=xt(a,"button","ur-twin-toolbar-button","data-ur-twin-view-button");w.setAttribute("type","button"),w.setAttribute("data-ur-twin-view-button",_.key),w.setAttribute("title",_.label),w.textContent=_.label,w.addEventListener("click",()=>nn(_.key)),xe.appendChild(w)}let ze=xt(a,"div","ur-twin-status","data-ur-twin-status"),mt=xt(a,"div","ur-twin-error","data-ur-twin-error");ae.appendChild(xe),ae.appendChild(Oe),ae.appendChild(G),ae.appendChild(ze),ae.appendChild(mt),i.appendChild(ae),xe.style.display="none",Oe.style.display="none",G.style.display="none",ze.textContent=Fv;let Ze=null,R=null,v=Nf(1),z=Jc(Bs);z.name="ur-twin-base-axes";let Y=Of(),Z=Uf(null),X={reach:!1,base:!1,force:!1,cog:!1};function Ee(){v.visible=X.reach,z.visible=X.base,Z.visible=!1,Y.visible=X.cog}Ee();let J=Jc(Bs);J.matrixAutoUpdate=!1;let ge=new _t,Se=new it(new Float32Array(Xr*3),3);Se.setUsage(Ya),ge.setAttribute("position",Se);let Q=new it(new Float32Array(Xr*3),3);Q.setUsage(Ya),ge.setAttribute("color",Q),ge.setDrawRange(0,0);let ue=Se.array,Ne=Q.array,ve=new Cn(ge,new vn({color:3526911,vertexColors:!0}));ve.name="ur-twin-trajectory",ve.frustumCulled=!1;let le=a.defaultView??(typeof globalThis.addEventListener=="function"?globalThis:null),ke=()=>Fe();le?.addEventListener?.("resize",ke);let O=null,ne=a.defaultView?.ResizeObserver??globalThis.ResizeObserver;if(typeof ne=="function")try{O=new ne(()=>Fe()),O.observe(i)}catch{O=null}function se(_){ze.textContent=_}function fe(){if(P){se(Wv);return}if(!D){let w=e?.getSnapshot?.()??{};se(Yv(w.code,w.error,w.ips));return}if(H){se(`${ll} \xB7 ${Gv}`);return}let _=e?.getSnapshot?.()?.detail?.safety_mode;if(Fu(_)){se(`${Zf(_)} \xB7 ${Xv}`);return}if(F){se(Vv);return}if(k!==""){se(`${ll} \xB7 ${Hv}${k}`);return}if(!h){se(Bv);return}se(h.usedFallback?`${ll} \xB7 ${p}${zv}`:`${ll} \xB7 ${p}`)}function ee(){if(u||F)return u;try{u=t(Re,{palette:nl(tl(a))})??{}}catch(_){return F=!0,u=null,k=_ instanceof Error?_.message:String(_),fe(),null}return u.scene?.add?.(J),u.scene?.add?.(ve),u.scene?.add?.(v),u.scene?.add?.(z),u.scene?.add?.(Y),u.scene?.add?.(Z),u.onCameraChange?.(()=>Ye()),Me(),$(),u}function $(){if(!u||P)return;let _=!1;try{_=u.resize?.()!==!1}catch{_=!1}y=!_}function Me(){let _=u?.renderer?.domElement??Re;_?.addEventListener&&(_.addEventListener("webglcontextlost",w=>{w?.preventDefault?.(),P=!0,fe()}),_.addEventListener("webglcontextrestored",()=>{P=!1,$(),fe()}))}function Fe(){$()}function st(){u?.render?.()}function Ye(){ce=!0}function nn(_){_==="reset"?u?.fitTo?.(h?.root):u?.setViewPreset?.(_),Ye()}function sn(){l!==null&&(r?.(l),l=null)}function ks(){c||re||l!==null||(l=s(Kr))}let bn=()=>{if(re=a.hidden===!0,re)sn();else{try{e?.retryNow?.(!1)}catch{}Ye(),ks()}};le?.addEventListener?.("visibilitychange",bn);let Hs=df(_=>{try{u?.applyTheme?.(nl(_))}catch{}Ye()},a);function Yr(_,w,U){let B=Number.isFinite(w?.ts)?w.ts:null;(B===null||B!==te)&&(te=B,W=_);let N=e?.getStreamHealth?.()??{},j=W===null?0:Math.max(0,_-W),ie=tS({status:N.status,connected:U,feedStale:w?.feedStale===!0,ageMs:j,frames:N.frames,frameErrors:N.frameErrors});if(ie!==oe&&(oe=ie,Ce.textContent=ie,Ce.style.display=ie===""?"none":"",Ce.setAttribute("data-ur-twin-feed-state",ie===""?"ok":ie.startsWith(Be.feedRetrying)?"retrying":"stale")),U&&j>Nv&&_-V>=Ov){V=_;try{e?.retryNow?.(!0)}catch{}}}function Vs(){let _=K.children.length>0;G.style.display=D||_?"":"none";for(let w of dt)w.style.display=D?"":"none"}function Wi(_){let w=Array.isArray(_?.ips)?_.ips.filter(N=>typeof N=="string"&&N!==""):[],U=typeof _?.ip=="string"?_.ip:"",B=`${U}|${w.join(",")}`;if(B!==M){M=B,K.textContent="";for(let N of w){let j=xt(a,"button","ur-twin-layer-toggle","data-ur-twin-robot");j.type="button",j.textContent=N,j.setAttribute("aria-pressed",N===U?"true":"false"),j.addEventListener("click",()=>{e?.setIp?.(N)}),K.appendChild(j)}Vs()}}function qr(_){_!==D?(D=_,ae.setAttribute("data-ur-twin-connected",_?"true":"false"),Oe.style.display=_?"":"none",Vs(),xe.style.display=_?"":"none",_||(A=null,E=null,C=null,f=null,x=[],m=0,ge.setDrawRange(0,0),_e.textContent="",de.textContent="",He.textContent="",He.setAttribute("data-ur-twin-overlimit","false"),pt.textContent="",I.textContent="",et.textContent="",Ce.textContent="",Ce.style.display="none",oe=null,W=null,te=null,V=-1/0,ae.setAttribute("data-ur-twin-hazard","false"),S=-1/0),Ye(),Fe(),fe()):_||fe()}async function Xi(_){let w=++g,U=null;try{U=await n(_,{armLinks:al(Uu(_)?.links)??void 0,fallbackColor:nl(tl(a)).fallbackArm})}catch(j){!c&&w===g&&(k=j instanceof Error?j.message:String(j),fe());return}if(!U)return;if(c||w!==g){U.dispose?.();return}k="";let B=ee()?.scene;B?.add?.(U.root),h&&(cl(B,h.root),h.dispose?.()),h=U,Iu(Ze),Ze=null,R=null;try{Ze=Pf(h),B?.add?.(Ze.root)}catch{Ze=null}p=String(_).trim().toLowerCase(),u?.fitTo?.(h?.root),yf(J,xf(u?.currentFitRadius?.()));let N=Df(Uu(p)?.links);N!==null&&v.scale.setScalar(N),ce=!0,fe()}function $r(_,w){return Number.isFinite(_)?C===null||_<C.hostTs?(C={hostTs:_,localTs:w},{ts:w,reset:!0}):{ts:C.localTs+(_-C.hostTs),reset:!1}:{ts:w,reset:!1}}function jr(_){if(b)return;let w=_?.tcp;if(!Array.isArray(w)||w.length<3||!Number.isFinite(w[0]))return;let U=Number.isFinite(_.ts)?_.ts:m+1;m=U;let B=Array.isArray(_?.q)&&_.q.length>=6?[..._.q]:void 0;x=kf(x,{tcp:[w[0],w[1],w[2]],ts:U,...B===void 0?{}:{q:B}},Pv),x.length>Xr&&(x=x.slice(x.length-Xr))}function hl(){let _=Hf(x),w=Math.min(_.length,Xr),U=_.length-w,B=Vf(x.slice(U));for(let N=0;N<w;N++){let j=_[U+N];ue[N*3]=j[0],ue[N*3+1]=j[1],ue[N*3+2]=j[2];let ie=B[N]??[1,1,1];Ne[N*3]=ie[0],Ne[N*3+1]=ie[1],Ne[N*3+2]=ie[2]}Se.needsUpdate=!0,Q.needsUpdate=!0,ge.setDrawRange(0,w)}function dl(_,w){let U=_?.tcp;if(Array.isArray(U)&&U.length>=3)return U;let B=w?.tool0;return Array.isArray(B)?[B[12],B[13],B[14],0,0,0]:null}function fl(_,w,U,B,N){if(!(_-S>=Lv))return;S=_;let j=[w?.model??p,w?.ip].filter(Ae=>typeof Ae=="string"&&Ae!=="");_e.textContent=j.length===0?"":Be.identity(w?.model??p,w?.ip),_e.setAttribute("title",_e.textContent);let ie=typeof w?.pendingMotion?.summary=="string"?w.pendingMotion.summary:"";de.textContent=ie===""?"":`${Be.pendingPrefix}  ${ie}`,de.setAttribute("title",de.textContent);let me=jv(U,N);He.textContent=me.length===0?jf(U):`${jf(U)}  ${Be.overLimit(`J${me.join("/J")}`)}`,He.setAttribute("data-ur-twin-overlimit",me.length===0?"false":"true"),He.setAttribute("title",He.textContent);let pe=dl(w,B);pt.textContent=pe?Kv(pe):"TCP  --",pt.setAttribute("title",pt.textContent);let be=oS(w?.detail);I.textContent=be.status,I.setAttribute("title",be.status),I.setAttribute("data-ur-twin-hazard",be.hazard?"true":"false");let De=[be.temps,be.power].filter(Boolean).join("   ");et.textContent=De,et.setAttribute("title",De),ae.setAttribute("data-ur-twin-hazard",be.hazard?"true":"false"),w?.ip&&ae.setAttribute("data-ur-twin-ip",String(w.ip))}function pl(_){let w=e?.getSnapshot?.()??{},U=w.connected===!0,B=H;if(H=w.degraded===!0,qr(U),Yr(_,w,U),Wi(w),!U)return;B!==H&&fe();let N=Fu(w?.detail?.safety_mode);N!==q&&(q=N,fe());let j=String(w.model??"").trim(),ie=j.toLowerCase();ie!==""&&ie!==d&&(d=ie,Xi(j));let me=Uu(p||ie),pe=Array.isArray(w.q)&&w.q.length>=6?w.q:null,be=null;if(me&&pe){let De=$r(w.ts,_);De.reset&&(A=null,E=null);let Ae=Number.isFinite(w.ts);T=w;let qe=!Ae||w.ts!==f||E===null;Ae&&(f=w.ts),qe&&(A=E,E={q:pe.slice(),ts:De.ts},jr(w),ce=!0,Te=_+Kf(A,E)+64);let tt=A?zf(A,E,_-Kf(A,E)):E.q.slice();if(be=Du(me,tt),h?.applyFK?.(be),Ze){let ft=w?.pendingMotion,rt=ft?.kind==="joints"?ft.q:null,nt=w?.detail?.target_q,Ie=je=>Array.isArray(je)&&je.length===6&&je.every(Number.isFinite),lt=Ie(rt)?rt:Ie(nt)?nt:null;lt===null?(R=null,Ze.setVisible(!1)):(lt!==R&&(R=lt,Ze.applyFK(Du(me,lt))),Ze.setPending(Ie(rt)),Ze.setVisible(!0))}Array.isArray(be.tool0)&&(J.matrix.fromArray(be.tool0),J.matrixWorldNeedsUpdate=!0,Z.position.set(J.matrix.elements[12],J.matrix.elements[13],J.matrix.elements[14]),X.force?Lu(Z,w?.detail?.tcp_force):Z.visible=!1),hl(),fl(_,w,pe,be,me?.jointLimits)}y&&$(),(ce||_<Te)&&(st(),ce=!1)}function Kr(){if(!(c||re))try{pl(o()),mt.textContent!==""&&(mt.textContent="")}catch(_){mt.textContent=`${kv}${_ instanceof Error?_.message:String(_)}`}finally{c||re?l=null:l=s(Kr)}}ks();function ml(){if(c)return;c=!0,l!==null&&(r?.(l),l=null),le?.removeEventListener?.("resize",ke),le?.removeEventListener?.("visibilitychange",bn),Hs(),O?.disconnect?.(),O=null;let _=u?.scene;h&&(cl(_,h.root),h.dispose?.(),h=null),cl(_,J),cl(_,ve),Iu(Ze),Ze=null;for(let w of[v,z,Y,Z])Ff(w);for(u?.dispose?.(),vf(J),ge.dispose(),ve.material?.dispose?.(),x=[],A=null,E=null,C=null,u=null,ae.parentNode===i?i.removeChild(ae):ae.remove?.();ae.firstChild;)ae.removeChild(ae.firstChild)}return{dispose:ml}}var tp="dsh-nonead-universal-robots/twin",lS="nonead-ur-twin",Qf="sidebar.right.pane.tab";function cS(){try{if(typeof require=="function")return require("react")}catch{}return null}function uS(i,e=16){let t=i.createElement;return t("svg",{width:e,height:e,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round","aria-hidden":"true"},t("path",{d:"M12 3v3.5M12 17.5V21M4.6 7.6l3 1.75M16.4 14.65l3 1.75M4.6 16.4l3-1.75M16.4 9.35l3-1.75"}),t("circle",{cx:12,cy:12,r:3.2}))}function hS({strings:i,react:e}){return{id:tp,kind:lS,title:()=>i.dockLabel,guide:[{id:"twin",order:5,title:()=>i.dockLabel,description:()=>i.dockDescription,icon:e?()=>uS(e):void 0}]}}function dS({react:i,mountPanel:e}){let t=i.createElement;function n(){let s=i.useRef(null);return i.useEffect(()=>{let r=s.current;if(!r)return;let o;try{o=e(r)}catch{o=void 0}return()=>{try{o?.dispose?.()}catch{}}},[]),t("div",{className:"dsh-ur-twin-tab-body",ref:s,style:{position:"absolute",inset:"0",display:"flex",minWidth:"0",minHeight:"0"}})}return n.displayName="UrTwinTabBody",n}function zu(i){return typeof i=="function"?i:()=>{}}function np({ctx:i,strings:e,mountPanel:t,onRegistered:n,react:s=cS()}){if(!i||!e||!s)return null;let r=hS({strings:e,react:s}),o=!1,a=!1,c=()=>{},l=()=>{},u=[],h=!1,d=()=>{if(!(a||o)){a=!0;try{n?.()}catch{}}},p=()=>{if(!s||typeof t!="function")return;let m=ul(i,"slots");if(!(!m||typeof m.inject!="function"))try{let f=dS({react:s,mountPanel:t});l=zu(m.inject(Qf,()=>m.register({name:Qf,key:tp},f)))}catch{l=()=>{}}},g=m=>{try{c=zu(m.register(r))}catch{return c=()=>{},!1}return p(),d(),!0},x=ul(i,"sidebarRightTabs");if(x&&typeof x.register=="function"){if(!g(x))return null;h=!0}else{if(typeof i.inject!="function")return null;{let m=ep(i,"sidebarRightTabs",f=>{if(!o&&g(f)&&s&&typeof t=="function"){let T=ul(i,"slots");(!T||typeof T.inject!="function")&&u.push(ep(i,"slots",()=>{o||p()}))}});u.push(m)}}return{immediate:h,dispose(){if(!o){o=!0;for(let m of u)try{m?.()}catch{}u=[];try{l?.()}catch{}try{c?.()}catch{}l=()=>{},c=()=>{}}}}}function ul(i,e){try{return typeof i.get=="function"?i.get(e):void 0}catch{return}}function ep(i,e,t){if(typeof i.inject!="function")return()=>{};try{return zu(i.inject([e],n=>{let s=n?.[e]??ul(n??i,e);s&&t(s)}))}catch{return()=>{}}}var fS="ur-digital-twin-client";function ip(i,e=globalThis){let t=[e?.__UR_TWIN_IP__,i?.ip,i?.robotIp];for(let n of t)if(typeof n=="string"&&n.trim()!=="")return n.trim()}function pS(i,e){let t=globalThis.document,n=ip(e),s=()=>{};try{s=qu(i)??s}catch(u){i.logger?.warn?.(`[ur-twin] \u5BBF\u4E3B locale \u7ED1\u5B9A\u5931\u8D25\uFF0C\u56DE\u9000\u6D4F\u89C8\u5668\u8BED\u8A00\uFF1A${u instanceof Error?u.message:String(u)}`)}let r=Wu({ip:n,stream:!0}),o={loaded:!0,at:Date.now(),ip:n,state:r,guide:void 0,entry:void 0,error:null};globalThis.__UR_TWIN__=o,i.logger?.info?.("[ur-twin] client half loaded");let a,c,l=u=>Jf({container:u,state:r});try{r.start();try{c=np({ctx:i,strings:Tn(),mountPanel:l,onRegistered:()=>{try{a?.dispose?.()}catch{}a=void 0,o.entry=void 0,i.logger?.info?.("[ur-twin] guide entry registered \u2014 host owns the card")}})}catch(h){c=void 0,i.logger?.warn?.(`[ur-twin] guide \u6CE8\u518C\u5931\u8D25\uFF0C\u56DE\u9000 DOM \u514B\u9686\uFF1A${h instanceof Error?h.message:String(h)}`)}c?.immediate||(a=Ju({doc:t,onToggle:h=>{o.active=h},mountPanel:l})),o.guide=c??null,o.entry=a;let u=c?.immediate?"guide-entry":"right-dock";i.logger?.info?.(`[ur-twin] mounted (ip=${n}, surface=${u})`)}catch(u){o.error=u instanceof Error?u.message:String(u),i.logger?.warn?.(`[ur-twin] \u5BA2\u6237\u7AEF\u88C5\u914D\u5931\u8D25\uFF1A${o.error}`)}return()=>{try{s?.()}catch{}try{c?.dispose?.()}catch{}try{a?.dispose?.()}catch{}try{r.stop()}catch{}c=void 0,a=void 0,delete globalThis.__UR_TWIN__}}
/*! Bundled license information:

three/build/three.core.js:
three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2025 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
return module.exports; } });
//# sourceMappingURL=client.js.map
