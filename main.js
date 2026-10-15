import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const $ = (id) => document.getElementById(id);
const fileInput = $('file-input'), fileList = $('file-list'), resultsList = $('results-list');
const startButton = $('start-button'), cancelButton = $('cancel-button'), clearButton = $('clear-button');
const engineStatus = $('engine-status'), warningBox = $('file-warning');
const MAX_FILES = 10, WARN_BYTES = 100 * 1024 * 1024, MAX_BYTES = 250 * 1024 * 1024;
let selected = [], results = [], ffmpeg = null, busy = false, cancelRequested = false, runId = 0;

const bytes = (n) => {
  if (!Number.isFinite(n)) return '不明';
  const units = ['B','KB','MB','GB']; let value=n, i=0;
  while(value>=1024 && i<units.length-1){value/=1024;i++;}
  return `${value.toLocaleString('ja-JP',{maximumFractionDigits:i?1:0})} ${units[i]}`;
};
const timeText = (s) => Number.isFinite(s) ? `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` : null;
const safeName = (name) => name.replace(/\\/g,'/').split('/').pop().replace(/[\u0000-\u001f<>:"|?*]/g,'_').replace(/\.+$/,'') || 'video';
const outputName = (name) => safeName(name).replace(/\.[^.]*$/,'') + '.mp4';
const setStatus = (el, text, cls='') => { el.textContent=text; el.className = el.className.replace(/\b(success|error)\b/g,'').trim(); if(cls) el.classList.add(cls); };
function showWarning(message){ warningBox.hidden = !message; warningBox.textContent = message || ''; }
function updateButtons(){ startButton.disabled = busy || selected.length===0; fileInput.disabled=busy; cancelButton.hidden=!busy; }
function fmtMeta(item){ const parts=[bytes(item.file.size)]; if(item.duration) parts.push(`再生 ${timeText(item.duration)}`); if(item.width && item.height) parts.push(`${item.width}×${item.height}`); return parts.join(' · '); }
function renderSelected(){
  fileList.replaceChildren();
  if(!selected.length){const p=document.createElement('p');p.className='empty';p.textContent='まだ動画が選択されていません。';fileList.append(p);}
  selected.forEach((item,idx)=>{
    const card=document.createElement('article');card.className='file-card';
    const info=document.createElement('div');const name=document.createElement('div');name.className='file-name';name.textContent=item.file.name;
    const meta=document.createElement('div');meta.className='file-meta';meta.textContent=fmtMeta(item);
    const status=document.createElement('div');status.className='file-status';status.textContent=item.status;
    info.append(name,meta,status); const remove=document.createElement('button');remove.className='small-button';remove.textContent='削除';remove.setAttribute('aria-label',`${item.file.name}を選択一覧から削除`);remove.disabled=busy;remove.addEventListener('click',()=>{selected.splice(idx,1);renderSelected();updateButtons();});card.append(info,remove);fileList.append(card);
  });
}
function renderResults(){
  resultsList.replaceChildren();
  if(!results.length){const p=document.createElement('p');p.className='empty';p.textContent='結果はまだありません。';resultsList.append(p);clearButton.disabled=true;$('summary').textContent='変換が終わると、ここに保存操作が表示されます。';return;}
  const ok=results.filter(r=>r.status==='success').length, fail=results.filter(r=>r.status==='error').length, cancel=results.filter(r=>r.status==='cancelled').length;
  $('summary').textContent=`成功 ${ok}本・失敗 ${fail}本・中止 ${cancel}本。成功は変換完了を示し、端末への保存完了を示すものではありません。`;
  results.forEach((r,idx)=>{
    const card=document.createElement('article');card.className='file-card';const info=document.createElement('div');const name=document.createElement('div');name.className='file-name';name.textContent=r.name;
    const meta=document.createElement('div');meta.className='file-meta';meta.textContent=r.status==='success'?`変換前 ${bytes(r.inputSize)} → 変換後 ${bytes(r.outputSize)}`:r.message;
    const status=document.createElement('div');status.className='file-status '+(r.status==='success'?'success':r.status==='error'?'error':'');status.textContent=r.status==='success'?'変換成功':r.status==='cancelled'?'中止':'変換失敗';info.append(name,meta,status);card.append(info);
    if(r.status==='success'){
      const actions=document.createElement('div');actions.className='result-actions';const save=document.createElement('button');save.className='small-button';save.textContent='MP4を保存';save.addEventListener('click',()=>downloadResult(r));actions.append(save);
      if(typeof navigator.share==='function' && typeof navigator.canShare==='function'){
        const share=document.createElement('button');share.className='small-button';share.textContent='共有';share.addEventListener('click',()=>shareResult(r));actions.append(share);
      }
      card.append(actions);
    } else if(r.status==='error'){
      const retry=document.createElement('button');retry.className='small-button';retry.textContent='この動画を再試行';retry.addEventListener('click',()=>retryResult(r));card.append(retry);
    }
    resultsList.append(card);
  });
  clearButton.disabled=busy || !results.some(r=>r.status==='success');
}
async function ensureEngine(){
  if(ffmpeg?.loaded) return ffmpeg;
  engineStatus.textContent='変換エンジンを読み込んでいます… 初回は時間がかかる場合があります。';
  const instance=new FFmpeg();
  instance.on('log', ({message})=>{ if(/Invalid data|Could not|Error|not supported/i.test(message)) engineStatus.textContent='動画情報を確認中…'; });
  instance.on('progress', ({progress})=>{
    if(!busy || !Number.isFinite(progress)) return;
    const pct=Math.max(0,Math.min(100,Math.round(progress*100)));$('progress-bar').value=pct;$('progress-number').textContent=`${pct}%`;
  });
  try{
    const base=new URL('./ffmpeg/',window.location.href).href;
    await instance.load({coreURL:await toBlobURL(base+'ffmpeg-core.js','text/javascript'),wasmURL:await toBlobURL(base+'ffmpeg-core.wasm','application/wasm')});
    ffmpeg=instance;engineStatus.textContent='変換エンジンの準備ができました。';return ffmpeg;
  }catch(e){instance.terminate();engineStatus.textContent='変換エンジンを読み込めません。通信・HTTPS・配信ファイルを確認してください。';throw new Error('変換エンジンの読み込みに失敗しました。ページを再読み込みして再試行してください。');}
}
function probeLogs(instance,filePath){
  return new Promise(async(resolve,reject)=>{
    let logs='';const handler=({message})=>{logs+=message+'\n';};instance.on('log',handler);
    try{await instance.exec(['-hide_banner','-i',filePath,'-t','0.1','-f','null','-']);resolve(logs);}
    catch(e){resolve(logs);}
    finally{instance.off('log',handler);}
  });
}
function parseMetadata(logs){
  const durationMatch=logs.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);const duration=durationMatch?Number(durationMatch[1])*3600+Number(durationMatch[2])*60+Number(durationMatch[3]):null;
  const videoLine=logs.split('\n').find(line=>line.includes('Video:'))||'';const dim=videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const hdr=/smpte2084|arib-std-b67|\bHLG\b|\bHDR\b/i.test(videoLine+' '+logs.match(/color_transfer[^\n]*/i)?.[0]);
  return {duration:Number.isFinite(duration)?duration:null,width:dim?Number(dim[1]):null,height:dim?Number(dim[2]):null,hdr};
}
async function safeDelete(instance,path){try{await instance.deleteFile(path);}catch{}}
async function convertOne(item,index,total,token){
  const instance=await ensureEngine();if(cancelRequested||token!==runId) throw new Error('中止しました');
  const id=`v${Date.now()}_${index}`;const inputPath=`${id}.input`;const outputPath=`${id}.mp4`;
  $('progress-label').textContent=`${total}本中、${index+1}本目を変換しています：${item.file.name}`;$('progress-number').textContent='準備中';$('progress-bar').removeAttribute('value');
  try{
    // ReadAsArrayBuffer and writeFile duplicate data in memory; this is not streaming.
    const data=new Uint8Array(await item.file.arrayBuffer());
    await instance.writeFile(inputPath,data);data.fill(0);
    const logs=await probeLogs(instance,inputPath);const metadata=parseMetadata(logs);
    if(!/Input #0|Duration:|Stream #0/.test(logs)) throw new Error('動画として読み取れません。破損しているか、対応していない形式の可能性があります。');
    if(metadata.hdr) throw new Error('HDR（PQ/HLG等）の可能性を検出したため、安全のため変換しません。SDR動画で再試行してください。');
    item.duration=metadata.duration;item.width=metadata.width;item.height=metadata.height;renderSelected();
    const args=['-hide_banner','-y','-i',inputPath,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='if(gte(iw,ih),min(1920,iw),min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),min(1920,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2",'-fpsmax','30','-c:v','libx264','-preset','veryfast','-crf','28','-pix_fmt','yuv420p','-c:a','aac','-b:a','96k','-map_metadata','-1','-movflags','+faststart','-max_muxing_queue_size','1024',outputPath];
    await instance.exec(args);
    if(cancelRequested||token!==runId) throw new Error('中止しました');
    const out=await instance.readFile(outputPath);if(!(out instanceof Uint8Array)||out.byteLength<16) throw new Error('変換結果が空か、不正です。');
    // Store one output Blob per result. Output blobs remain in memory until cleared or page close.
    const blob=new Blob([out],{type:'video/mp4'});out.fill(0);
    const r={id:`r${Date.now()}_${index}`,name:outputName(item.file.name),originalName:item.file.name,inputSize:item.file.size,outputSize:blob.size,status:'success',blob,message:'変換に成功しました'};
    results.push(r);return r;
  }catch(e){
    if(cancelRequested||token!==runId) return {status:'cancelled',name:outputName(item.file.name),originalName:item.file.name,inputSize:item.file.size,message:'利用者が中止しました'};
    const message=String(e?.message||e).includes('Aborted')?'処理が中断されました。メモリ不足やブラウザによる停止の可能性があります。':String(e?.message||e);
    const r={id:`r${Date.now()}_${index}`,name:outputName(item.file.name),originalName:item.file.name,inputSize:item.file.size,status:'error',message:message+' 短い動画で再試行してください。'};results.push(r);return r;
  }finally{await safeDelete(instance,inputPath);await safeDelete(instance,outputPath);}
}
async function runQueue(items){
  if(busy)return;busy=true;cancelRequested=false;runId++;const token=runId;results=[];renderResults();updateButtons();renderSelected();$('progress-area').hidden=false;$('progress-bar').value=0;
  try{
    for(let i=0;i<items.length;i++){
      if(cancelRequested||token!==runId) break;
      const item=items[i];const result=await convertOne(item,i,items.length,token);
      if(result.status==='cancelled') break;
      renderResults();
    }
    if(cancelRequested){$('progress-label').textContent='変換を中止しました。';engineStatus.textContent='中止しました。再試行する場合は、必要に応じてエンジンを再読み込みします。';}
    else {$('progress-label').textContent='処理が終了しました。';$('progress-bar').value=100;$('progress-number').textContent='完了';}
  }catch(e){engineStatus.textContent=e.message;}
  finally{busy=false;updateButtons();renderSelected();renderResults();}
}
async function downloadResult(r){
  try{const url=URL.createObjectURL(r.blob);const a=document.createElement('a');a.href=url;a.download=r.name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  catch(e){alert('ダウンロードを開始できませんでした。ブラウザの設定を確認してください。');}
}
async function shareResult(r){
  try{const file=new File([r.blob],r.name,{type:'video/mp4'});if(!navigator.canShare({files:[file]})){alert('この環境ではファイル共有に対応していません。「MP4を保存」をお使いください。');return;}await navigator.share({files:[file],title:r.name});}
  catch(e){if(e?.name==='AbortError')return;alert('共有を開始できませんでした。ダウンロードをお試しください。');}
}
async function retryResult(r){
  const item=selected.find(x=>x.file.name===r.originalName);
  if(!item){alert('元の動画が選択一覧にありません。もう一度動画を選択してください。');return;}
  results=results.filter(x=>x!==r);renderResults();await runQueue([item]);
}
fileInput.addEventListener('change',()=>{
  showWarning('');const incoming=Array.from(fileInput.files||[]);fileInput.value='';let warnings=[];
  for(const file of incoming){
    if(selected.length>=MAX_FILES){warnings.push('一度に選べる動画は最大10本です。');break;}
    if(!/\.mov$/i.test(file.name) && file.type!=='video/quicktime'){warnings.push(`${file.name}：MOVファイルとして認識できないため除外しました。`);continue;}
    if(file.size===0){warnings.push(`${file.name}：ファイルサイズが0です。`);continue;}
    if(file.size>MAX_BYTES){warnings.push(`${file.name}：250MBを超えるため受付できません。短い動画に分割してお試しください。`);continue;}
    if(file.size>WARN_BYTES) warnings.push(`${file.name}：大容量です。メモリ不足で失敗する可能性があります。`);
    if(selected.some(x=>x.file.name===file.name&&x.file.size===file.size)){warnings.push(`${file.name}：同名・同サイズの動画がすでにあります。`);continue;}
    selected.push({file,status:'選択済み',duration:null,width:null,height:null});
  }
  if(warnings.length)showWarning(warnings.join('\n'));renderSelected();updateButtons();
});
startButton.addEventListener('click',()=>{if(selected.length)runQueue([...selected]);});
cancelButton.addEventListener('click',()=>{
  if(!busy)return;cancelRequested=true;cancelButton.disabled=true;engineStatus.textContent='中止処理中…';
  // Terminating FFmpeg stops its worker, so no hidden encode continues. A fresh instance is created next run.
  if(ffmpeg){try{ffmpeg.terminate();}catch{}ffmpeg=null;}
  runId++;busy=false;updateButtons();$('progress-label').textContent='中止しました。';$('progress-number').textContent='';$('progress-bar').removeAttribute('value');engineStatus.textContent='中止しました。次回の変換時にエンジンを再読み込みします。';renderResults();renderSelected();cancelButton.disabled=false;
});
clearButton.addEventListener('click',()=>{results=[];renderResults();});
$('reset-button').addEventListener('click',()=>{if(busy)return;selected=[];results=[];showWarning('');renderSelected();renderResults();updateButtons();$('progress-area').hidden=true;engineStatus.textContent='変換エンジンは未読み込みです。';});
window.addEventListener('pagehide',()=>{if(ffmpeg){try{ffmpeg.terminate();}catch{}ffmpeg=null;}for(const r of results)if(r.url)URL.revokeObjectURL(r.url);});
if(!('Worker' in window)||!('WebAssembly' in window)){engineStatus.textContent='このブラウザは必要なWorker/WebAssembly機能に対応していません。最新のSafariまたはEdgeをお試しください。';startButton.disabled=true;}
renderSelected();renderResults();updateButtons();
