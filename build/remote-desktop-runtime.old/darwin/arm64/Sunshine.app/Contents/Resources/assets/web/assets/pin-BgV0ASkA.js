import{c as t,a,i as r}from"./createLucideIcon-DVLzloNF.js";import{N as o}from"./Navbar-Cyg_8cFT.js";import{a as s}from"./fetch_utils-CmyVrFz4.js";import{X as d}from"./x-CV3nG6ml.js";import{M as p}from"./monitor-0UIPZmef.js";import"./Notification-BOwgdowf.js";/**
 * @license lucide-vue-next v1.0.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c=t("forward",[["path",{d:"m15 17 5-5-5-5",key:"nf172w"}],["path",{d:"M4 18v-2a4 4 0 0 1 4-4h12",key:"jmiej9"}]]);/**
 * @license lucide-vue-next v1.0.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=t("hash",[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]);/**
 * @license lucide-vue-next v1.0.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=t("user-round-search",[["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"M2 21a8 8 0 0 1 10.434-7.62",key:"1yezr2"}],["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["path",{d:"m22 22-1.9-1.9",key:"1e5ubv"}]]);let l=a({components:{Navbar:o,Forward:c,Hash:h,Monitor:p,UserRoundSearch:g,X:d},inject:["i18n"],data(){return{name:"",pendingPairings:[],pin:"",refreshTimer:null,selectedPairingId:"",status:null}},mounted(){this.loadPendingPairings(),this.refreshTimer=window.setInterval(()=>this.loadPendingPairings(),2e3)},beforeUnmount(){window.clearInterval(this.refreshTimer)},methods:{async loadPendingPairings(){try{const i=await s("./api/pin",{method:"GET"});if(!i.ok)throw new Error(`HTTP ${i.status}`);const e=await i.json();this.pendingPairings=e.pairings||[],this.pendingPairings.some(n=>n.id===this.selectedPairingId)||(this.selectedPairingId=this.pendingPairings.length===1?this.pendingPairings[0].id:"")}catch(i){console.error("Failed to load pending pairing requests",i),this.status={type:"danger",message:this.i18n.t("pin.load_failure")}}},async registerDevice(){if(this.status=null,!this.selectedPairingId){this.status={type:"danger",message:this.i18n.t("pin.select_pairing_required")};return}const i=JSON.stringify({pairing_id:this.selectedPairingId,pin:this.pin,name:this.name});(await(await s("./api/pin",{method:"POST",headers:{"Content-Type":"application/json"},body:i})).json()).status===!0?(this.status={type:"success",message:this.i18n.t("pin.pair_success")},this.pin="",this.name=""):this.status={type:"danger",message:this.i18n.t("pin.pair_failure")},await this.loadPendingPairings()},async cancelSelectedPairing(){if(!this.selectedPairingId)return;const e=await(await s("./api/pin",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({pairing_id:this.selectedPairingId})})).json();this.status=e.status===!0?{type:"success",message:this.i18n.t("pin.cancel_success")}:{type:"danger",message:this.i18n.t("pin.cancel_failure")},await this.loadPendingPairings()}}});r(l);
