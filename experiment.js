'use strict';
const app = document.getElementById('app');
const progressEl = document.getElementById('progress');
const STORAGE_KEY = 'color-sequence-experiment-v2';
let CFG, PALETTES, session, activeTrial = null, pendingPayload = null;
let submitting = false, storageAvailable = true;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const participantName = () => session?.screening?.crowdworks_username || session?.participant || '';
function validWorkerName(value) { return typeof value === 'string' && value.length >= 1 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value); }
const round = x => Math.round(x * 1000) / 1000;
function parseAge(value) {
  const normalized = String(value).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
  return /^\d{1,3}$/.test(normalized) ? Number(normalized) : NaN;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function buildFullPlan(cfg = CFG) {
  const practice = cfg.practice_trials.map(x => ({isPractice:true, colorCondition:x.color_condition, targetCount:x.target_count}));
  const main = [];
  for (let rep = 0; rep < cfg.reps_per_cell; rep++)
    for (const cc of cfg.color_conditions)
      for (const tc of cfg.target_counts) main.push({isPractice:false, colorCondition:cc, targetCount:tc, repetition:rep + 1});
  return [...practice, ...shuffle(main)];
}
function validateConfig(cfg, palettes) {
  if (!Number.isInteger(cfg.reps_per_cell) || cfg.reps_per_cell < 1 || cfg.grid_size !== 5) throw Error('試行設定を確認してください。');
  if (!['online','offline'].includes(cfg.mode)) throw Error('実施方法の設定を確認してください。');
  if (!cfg.color_conditions.length || !cfg.target_counts.length || !cfg.practice_trials.length) throw Error('条件または練習が設定されていません。');
  if (![cfg.background_hex,cfg.distractor_hex,cfg.baseline_hex].every(x => /^#[0-9a-f]{6}$/i.test(x))) throw Error('表示色の設定を確認してください。');
  if ([cfg.background_hex,cfg.distractor_hex].some(x => x.toLowerCase() === cfg.baseline_hex.toLowerCase())) throw Error('同色条件のターゲット色を確認してください。');
  const all = [...cfg.practice_trials, ...cfg.color_conditions.flatMap(color_condition => cfg.target_counts.map(target_count => ({color_condition,target_count})))];
  for (const x of all) {
    if (![4,7].includes(x.target_count)) throw Error('ターゲット数の設定を確認してください。');
    if (x.color_condition === 'baseline') continue;
    const p = palettes[x.color_condition + '_' + x.target_count];
    if (!p || p.length !== x.target_count || !p.every(c => /^#[0-9a-f]{6}$/i.test(c.hex))) throw Error('色の設定が不足しています。');
  }
  if (!Number.isFinite(cfg.fixation_sec) || cfg.fixation_sec < 0 || !Number.isFinite(cfg.post_blank_sec) || cfg.post_blank_sec < 0) throw Error('表示時間の設定を確認してください。');
}
function checkpoint() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({session, pendingPayload})); }
  catch (_) { storageAvailable = false; }
}
function downloadJSON() {
  const data = pendingPayload || {schema_version:2, session, status:'incomplete'};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}));
  a.download = 'experiment_' + (session?.participant || 'backup') + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function environmentOK() {
  return innerWidth >= CFG.min_viewport_width && innerHeight >= CFG.min_viewport_height && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}
function showConsentScreen() {
  const online = CFG.mode === 'online';
  app.innerHTML = `<div class="screen"><h1>色の優先順位に関する実験</h1>
  <p>以下の説明をご確認のうえ、ユーザー名などを入力してください。課題の操作方法は、次の画面で説明します。</p>
  <div id="consentBox" tabindex="0" role="region" aria-label="実験の説明">
  <p>本研究では、色の違いが選択の順序に及ぼす影響を調べます。色付きのマスを選ぶ課題を、操作の練習、本番、事後アンケートの順に行います。</p>
  <p>所要時間：${esc(CFG.estimated_minutes)}${CFG.estimated_minutes === '確認中' ? '（募集前に確定します）' : '分程度'}。${online ? '謝礼：500円。色の選び方や速さで金額が変わることはありません。' : '研究室内での対面実施用です。'}</p>
  <p>参加は任意で、いつでも中止できます。中止や通信不良の場合は担当者へご連絡ください。謝礼の取り扱いは募集時の案内に従います。</p>
  <p>クリック順序・反応時間・位置、選択肢への回答、画面サイズ、画面離脱などを記録します。回答は研究・学術発表に使用し、個人が特定される形では公表しません。クラウドワークスのユーザー名を、参加・完了の確認と謝礼支払いのために記録します。分析・公表用のデータではユーザー名を識別番号に置き換えます。</p>
  <p>中断・送信失敗に備え、このブラウザ内にも一時保存します。送信確認後は一時保存を削除します。中断時の一時保存は自動送信されません。保存期間：${esc(CFG.data_retention)}。</p>
  <p>担当：${esc(CFG.contact_name)}<br>連絡先：${esc(CFG.contact_email)}</p>
  </div>
  <p>PCのGoogle Chromeとマウスで操作してください。画面の色を変える機能（夜間モード等）はオフにし、ブラウザを最大化してください。</p>
  <label class="check">クラウドワークスのユーザー名 <input id="workerNameInput" class="input-field" maxlength="100" autocomplete="off" aria-describedby="workerNameHint"></label>
  <p id="workerNameHint">クラウドワークスで表示されているユーザー名を、そのまま入力してください。実名・メールアドレスを別途入力する必要はありません。</p>
  <label class="check">年齢 <input id="ageInput" class="input-field" type="text" inputmode="numeric" maxlength="12" aria-describedby="ageHint"> 歳</label>
  <p id="ageHint">全角・半角どちらの数字でも入力できます。</p>
  <label class="check">性別 <select id="genderInput" class="input-field"><option value="no_answer">回答しない</option><option value="male">男性</option><option value="female">女性</option><option value="other">その他</option></select></label>
  <label class="check">使用PC・モニター（任意）<input id="deviceSpecInput" class="input-field" maxlength="200"></label>
  <label class="check"><input id="eligibilityCheck" type="checkbox">マウスを使用し、裸眼または矯正して画面を見ることに支障がなく、色覚について指摘・診断を受けたことがないことを確認しました</label>
  <p>参加条件に当てはまらない場合や不明な場合は、開始せず、クラウドワークスのメッセージで担当者へお問い合わせください。</p>
  <label class="check"><input id="agreeCheck" type="checkbox">説明と動作環境を確認し、参加に同意します</label>
  <p id="consentError" class="notice" role="alert"></p><button id="consentBtn">課題説明へ進む</button></div>`;
  $('consentBtn').onclick = () => {
    const workerName = $('workerNameInput').value.trim(), age = parseAge($('ageInput').value);
    const error = msg => $('consentError').textContent = msg;
    if (!validWorkerName(workerName)) return error('クラウドワークスのユーザー名を100文字以内で入力してください。改行などの制御文字は使用できません。');
    if (!Number.isInteger(age) || age < 18 || age > 120) return error('年齢を数字で入力してください（例：22、２２）。対象は18歳以上です。');
    $('ageInput').value = String(age);
    if (!$('eligibilityCheck').checked) return error('募集ページの参加条件をご確認ください。条件を満たす場合のみ、確認欄にチェックを入れてください。');
    if (!$('agreeCheck').checked) return error('同意いただける場合はチェックを入れてください。');
    if (!environmentOK()) return error('PCでブラウザを最大化してください。表示領域は幅800px・高さ620px以上必要です。');
    session = {participant:'CW_' + uid().replace(/-/g,''), session_id:uid(), submission_id:uid(), started_at:new Date().toISOString(),
      program_version:CFG.version, config_snapshot:structuredClone(CFG), palette_snapshot:structuredClone(PALETTES),
      screening:{age, gender:$('genderInput').value, device_type:'pc_mouse', crowdworks_username:workerName, eligibility_confirmed:true, device_spec:$('deviceSpecInput').value,
        vision:'eligibility_self_report',color_vision:'eligibility_self_report',screen_width:screen.width,screen_height:screen.height,
        viewport_width:innerWidth,viewport_height:innerHeight,device_pixel_ratio:devicePixelRatio,user_agent:navigator.userAgent},
      plan:buildFullPlan(), cursor:0, trials:[], trial_metadata:[], quality_events:[], phase:'instructions'};
    checkpoint(); showInstructions();
  };
}
function showInstructions() {
  const count = session.plan.filter(x => !x.isPractice).length;
  app.innerHTML = `<div class="screen"><h1>課題の説明</h1>
  <p>5×5のマスのうち、4個または7個に色が付きます。</p>
  <p><b>あまり考えず、なるべく早く、第一印象で「重要そうだ」「先に対処すべきだ」と感じる順に、色付きのマスを1つずつクリックしてください。</b></p>
  <p>色付きのマスをすべて選ぶと次へ進みます。クリック済みのマスは、色の付いていないマスと同じグレーに変わります。制限時間はありません。</p>
  <p>すべて同じ色の試行もあります。その場合も同じように、第一印象で選んでください。</p>
  <p>練習は${CFG.practice_trials.length}回、本番は${count}回です。本番中は画面下に進み具合が表示されます。最後に、選び方についてお聞きします。</p>
  <button id="startPracticeBtn">練習を始める</button></div>`;
  $('startPracticeBtn').onclick = () => { session.phase='running'; checkpoint(); runNextTrial(); };
}
function updateProgress(cond) {
  const n = cond.isPractice ? session.cursor + 1 : session.cursor - CFG.practice_trials.length + 1;
  const total = cond.isPractice ? CFG.practice_trials.length : session.plan.length - CFG.practice_trials.length;
  progressEl.textContent = `${cond.isPractice ? '練習' : '本番'} ${n} / ${total}回`;
}
function runNextTrial() {
  if (session.cursor >= session.plan.length) return showQuestionnaire();
  const cond = session.plan[session.cursor]; updateProgress(cond);
  if (document.hidden || !environmentOK()) {
    app.innerHTML='<div class="screen"><h1>表示環境の確認</h1><p>実験画面に戻り、PCでブラウザを最大化してください。</p><button id="continueBtn">続ける</button></div>';
    $('continueBtn').onclick=runNextTrial; return;
  }
  document.body.style.background = CFG.background_hex;
  app.innerHTML='<div id="fixation">+</div>';
  setTimeout(() => { if (document.hidden || !environmentOK()) return runNextTrial(); runTrial(cond); }, CFG.fixation_sec * 1000);
}
function runTrial(cond) {
  const n = CFG.grid_size ** 2, indices = shuffle([...Array(n).keys()]).slice(0,cond.targetCount);
  const palette = cond.colorCondition === 'baseline'
    ? Array.from({length:cond.targetCount}, () => ({level:null,hex:CFG.baseline_hex}))
    : PALETTES[cond.colorCondition + '_' + cond.targetCount];
  const targetMap = new Map(indices.map((idx,i) => [idx,palette[i]]));
  const mainNumber = cond.isPractice ? null : session.cursor - CFG.practice_trials.length + 1;
  const trial = {trial_num:mainNumber, session_trial_index:session.cursor + 1, is_practice:cond.isPractice,
    color_condition:cond.colorCondition,target_count:cond.targetCount,repetition:cond.repetition || null,
    started_at:new Date().toISOString(), viewport_width:innerWidth,viewport_height:innerHeight,
    targets:indices.map((idx,i)=>({grid_index:idx,grid_x:idx%5,grid_y:Math.floor(idx/5),color_level:palette[i].level,hex:palette[i].hex})),
    quality_events:[], invalid_clicks:0, complete:false};
  app.innerHTML='<div id="taskContainer"><div id="conditionBanner">'+(cond.isPractice?'練習':'本番')+'</div><div id="gridArea" style="visibility:hidden"></div></div>';
  const grid=$('gridArea'), cells=[];
  for(let i=0;i<n;i++) {
    const cell=document.createElement('div'); cell.className='cell'; cell.dataset.index=i;
    cell.dataset.active=targetMap.has(i)?'1':'0'; cell.style.background=targetMap.has(i)?targetMap.get(i).hex:CFG.distractor_hex;
    cell.setAttribute('aria-label','マス '+(i+1)); grid.appendChild(cell); cells.push(cell);
  }
  let clickOrder=0,lastTime=0,onset=0,lastPos=null,finished=false,enabled=false;
  activeTrial=trial;
  function onClick(e) {
    if(!enabled || finished) return;
    const el=e.currentTarget,now=performance.now();
    if(el.dataset.active!=='1'){trial.invalid_clicks++;return;}
    const idx=Number(el.dataset.index),rect=el.getBoundingClientRect(),center={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    clickOrder++;
    if(!cond.isPractice) session.trials.push({participant:session.participant,session_id:session.session_id,
      trial_num:mainNumber,session_trial_index:session.cursor+1,color_condition:cond.colorCondition,target_count:cond.targetCount,
      repetition:cond.repetition,time_limit_condition:false,click_order:clickOrder,grid_index:idx,grid_x:idx%5,grid_y:Math.floor(idx/5),
      color_level:targetMap.get(idx).level,hex_code:targetMap.get(idx).hex,rt_ms:round(now-lastTime),elapsed_ms:round(now-onset),
      timestamp_ms:round(now),click_x:e.clientX,click_y:e.clientY,center_x:round(center.x),center_y:round(center.y),
      distance_px:lastPos?round(Math.hypot(center.x-lastPos.x,center.y-lastPos.y)):null,timed_out:false});
    el.dataset.active='0';el.style.background=CFG.distractor_hex;lastTime=now;lastPos=center;
    if(clickOrder===cond.targetCount) {
      finished=true;trial.complete=true;trial.duration_ms=round(now-onset);activeTrial=null;
      cells.forEach(c=>c.removeEventListener('click',onClick));
      if(!cond.isPractice) session.trial_metadata.push(trial);
      session.cursor++;checkpoint();
      // Clear the completed display immediately, so post_blank_sec really is a blank interval.
      app.innerHTML='';
      if(session.cursor===CFG.practice_trials.length) {
        progressEl.textContent='練習終了';
        app.innerHTML=`<div class="screen"><h1>練習が終了しました</h1><p>本番は${session.plan.length-CFG.practice_trials.length}回です。あまり考えず、なるべく早く、第一印象で選んでください。</p><button id="startMainBtn">本番を始める</button></div>`;
        $('startMainBtn').onclick=runNextTrial;
      } else setTimeout(runNextTrial,CFG.post_blank_sec*1000);
    }
  }
  cells.forEach(c=>c.addEventListener('click',onClick));
  requestAnimationFrame(()=>{grid.style.visibility='visible';onset=performance.now();lastTime=onset;trial.onset_ms=round(onset);enabled=true;});
}
function recordQuality(type) {
  if(!session || session.phase!=='running')return;
  const event={type,timestamp_ms:round(performance.now()),session_trial_index:session.cursor+1};
  session.quality_events.push(event);
  if(activeTrial) activeTrial.quality_events.push(event);
}
document.addEventListener('visibilitychange',()=>recordQuality(document.hidden?'hidden':'visible'));
window.addEventListener('blur',()=>recordQuality('window_blur'));
window.addEventListener('resize',()=>recordQuality('resize'));
window.addEventListener('beforeunload',e=>{
  if(session && !['complete','offline_saved'].includes(session.phase)){checkpoint();e.preventDefault();e.returnValue='';}
});
const strategies=[['dark','暗い色を先に選んだ'],['light','明るい色を先に選んだ'],['red','赤いと感じる色を先に選んだ'],['other_hue','赤以外の特定の色合いを先に選んだ'],['vivid','鮮やかに感じる色を先に選んだ'],['near','直前に選んだマスから近いものを選んだ'],['position','上から・左からなど、位置の順番で選んだ'],['changed','途中で選び方を変えた'],['no_rule','特に基準を決めずに選んだ'],['other','その他']];
function strategyGroup(id,title) {
  const options=id==='baselineStrategy'
    ? [...strategies.filter(([v])=>['near','position','changed','no_rule','other'].includes(v)),['first_seen','最初に目に入ったものから選んだ']]
    : strategies;
  return `<fieldset><legend>${title}（複数選択可）</legend>${options.map(([v,label])=>`<label><input type="checkbox" name="${id}" value="${v}"> ${label}</label>`).join('')}</fieldset>`;
}
function showQuestionnaire() {
  session.phase='questionnaire';activeTrial=null;checkpoint();progressEl.textContent='本番終了';document.body.style.background='#444';
  app.innerHTML=`<div class="screen"><h1>事後アンケート</h1><p>実際に行った選び方についてお答えください。色の違いがある試行と、すべて同じ色の試行を分けてお聞きします。</p>
  ${strategyGroup('colorStrategy','1 色の違いがある試行での選び方')}
  ${strategyGroup('baselineStrategy','2 すべて同じ色の試行での選び方')}
  <label class="check">3 「その他」を選んだ場合の説明、途中で選び方が変わった場合の変化（任意）<textarea id="qOther" maxlength="4000" rows="3"></textarea></label>
  <label class="check">4 マスの数（4個・7個）による選び方の違いや、見にくい・区別しにくい色について（任意）<textarea id="qCountEffect" maxlength="4000" rows="3"></textarea></label>
  <label class="check">5 感想、説明・操作で分かりにくかった点、不具合など（任意）<textarea id="qFeedback" maxlength="4000" rows="3"></textarea></label>
  <p id="surveyError" class="notice" role="alert"></p><button id="submitQBtn">${CFG.mode==='offline'?'回答を確定して保存へ進む':'回答を送信する'}</button></div>`;
  if(session.surveyDraft){
    for(const name of ['colorStrategy','baselineStrategy'])document.querySelectorAll(`input[name="${name}"]`).forEach(el=>{el.checked=session.surveyDraft[name].includes(el.value);});
    for(const id of ['qOther','qCountEffect','qFeedback'])$(id).value=session.surveyDraft[id];
  }
  const saveDraft=()=>{session.surveyDraft={};for(const name of ['colorStrategy','baselineStrategy'])session.surveyDraft[name]=[...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);for(const id of ['qOther','qCountEffect','qFeedback'])session.surveyDraft[id]=$(id).value;checkpoint();};
  app.oninput=saveDraft;app.onchange=saveDraft;
  $('submitQBtn').onclick=()=>{
    saveDraft();const d=session.surveyDraft;
    if(!d.colorStrategy.length || !d.baselineStrategy.length){$('surveyError').textContent='1と2で、当てはまる選び方をそれぞれ選んでください。';return;}
    app.oninput=null;app.onchange=null;
    const count=session.plan.filter(x=>!x.isPractice).length;
    pendingPayload={schema_version:2,submission_id:session.submission_id,participant:session.participant,
      session_id:session.session_id,program_version:CFG.version,started_at:session.started_at,finished_at:new Date().toISOString(),
      expected_trial_count:count,trials:session.trials,trial_metadata:session.trial_metadata,
      survey:{...session.screening,color_strategy:d.colorStrategy,baseline_strategy:d.baselineStrategy,other_strategy:d.qOther,count_effect:d.qCountEffect,feedback:d.qFeedback},
      quality_events:session.quality_events,config_snapshot:session.config_snapshot,palette_snapshot:session.palette_snapshot,
      local_backup_available:storageAvailable};
    session.phase='submitting';checkpoint();
    if(CFG.mode==='offline')showOfflineSave();else submitPayload();
  };
}
function showSubmitError() {
  app.innerHTML=`<div class="screen"><h1>保存の確認ができませんでした</h1><p>課題をやり直す必要はありません。通信状態を確認して再送してください。</p><p>${storageAvailable?'回答はこのブラウザ内に一時保存されています。この画面を閉じた場合も、同じPC・ブラウザで実験URLを開くと再送できます。':'このブラウザでは回答の一時保存を確認できません。この画面を閉じずに再送してください。'}</p><p>確認できない場合は、クラウドワークスのユーザー名を添えてクラウドワークスのメッセージでご連絡ください。完了コードは、オンラインで保存を確認できた場合に表示されます。</p><p>ユーザー名：${esc(participantName())}</p><button id="retryBtn">同じ回答を再送する</button></div>`;
  $('retryBtn').onclick=submitPayload;
}
async function submitPayload() {
  if(submitting)return;submitting=true;
  app.innerHTML='<div class="screen"><h1>データを送信しています</h1><p>保存を確認するまで、この画面を閉じずにお待ちください。</p></div>';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),CFG.submission_timeout_ms);
  try {
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(CFG.gas_endpoint))throw Error('保存先未設定');
    const response=await fetch(CFG.gas_endpoint,{method:'POST',body:new URLSearchParams({data:JSON.stringify(pendingPayload)}),signal:controller.signal,redirect:'follow',credentials:'omit'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const ack=await response.json();
    if(ack.ok!==true || ack.submission_id!==pendingPayload.submission_id || !/^DONE-[A-F0-9]{16}$/.test(ack.completion_code || ''))throw Error('保存確認が不正');
    session.phase='complete';try{localStorage.removeItem(STORAGE_KEY);}catch(_){}
    try{sessionStorage.setItem('color-sequence-receipt',JSON.stringify({participant:session.participant,crowdworks_username:participantName(),code:ack.completion_code}));}catch(_){}
    showThankYouScreen(ack.completion_code);
  } catch(_){showSubmitError();}
  finally{clearTimeout(timer);submitting=false;}
}
function showThankYouScreen(code) {
  progressEl.textContent='完了';
  app.innerHTML=`<div class="screen"><h1>保存が完了しました</h1><p>実験へのご協力ありがとうございました。</p><p>ユーザー名：${esc(participantName())}</p><p>完了コード：<strong style="user-select:all">${esc(code)}</strong></p><p>このコードをクラウドワークスのメッセージで担当者へ送り、納品手続きを行ってください。</p></div>`;
}
function showOfflineSave() {
  app.innerHTML='<div class="screen"><h1>担当者にお知らせください</h1><p>回答をこの端末に保存します。オンライン送信やクラウドワークス用の完了コード発行は行いません。</p><button id="backupBtn">回答データを保存する</button><p>担当者はダウンロードしたファイルを確認してから、下のボタンを押してください。</p><button id="offlineDoneBtn">ファイルの保存を確認した（担当者用）</button></div>';
  $('backupBtn').onclick=downloadJSON;
  $('offlineDoneBtn').onclick=()=>{session.phase='offline_saved';try{localStorage.removeItem(STORAGE_KEY);}catch(_){}app.innerHTML='<div class="screen"><h1>実験終了</h1><p>ご協力ありがとうございました。</p></div>';};
}
function showRecovery(saved) {
  session=saved.session;pendingPayload=saved.pendingPayload;
  const preMain = canReturnToInstructions(session,pendingPayload);
  const title = pendingPayload ? '回答の送信を再開できます' : preMain ? '実験を続ける方へ' : session.phase==='questionnaire' ? '事後アンケートを再開できます' : '実施途中の記録があります';
  const message = preMain ? '前回入力した情報がこのブラウザに残っています。本番はまだ始まっていません。続ける場合は、下のボタンから課題の説明へ進んでください。練習は最初から行います。' : pendingPayload ? '回答が一時保存されています。課題をやり直さず、下のボタンから送信を再開してください。' : session.phase==='questionnaire' ? '選択課題の記録は保存されています。事後アンケートを続けてください。' : '本番の途中で画面が閉じられた記録があります。最初からやり直さず、クラウドワークスのユーザー名を添えて担当者へご連絡ください。';
  app.innerHTML='<div class="screen"><h2 style="font-size:18px">'+title+'</h2><p>ユーザー名：'+esc(participantName())+'</p><p>'+message+'</p>'+(pendingPayload?'<button id="resumeSendBtn">同じ回答を送信して保存を確認する</button>':(session.phase==='questionnaire'?'<button id="resumeSurveyBtn">事後アンケートへ戻る</button>':preMain?'<button id="resumeInstructionsBtn">課題の説明へ進む</button>':''))+'</div>';
  if($('resumeSendBtn'))$('resumeSendBtn').onclick=()=>{if(CFG.mode==='offline')showOfflineSave();else submitPayload();};
  if($('resumeSurveyBtn'))$('resumeSurveyBtn').onclick=showQuestionnaire;
  if($('resumeInstructionsBtn'))$('resumeInstructionsBtn').onclick=()=>{session.cursor=0;session.phase='instructions';checkpoint();showInstructions();};
}
function canReturnToInstructions(savedSession,payload) {
  if(payload || !Array.isArray(savedSession.plan) || !Array.isArray(savedSession.trials) || savedSession.trials.length || (savedSession.trial_metadata||[]).length) return false;
  return savedSession.phase==='instructions' || (savedSession.phase==='running' && Number.isInteger(savedSession.cursor) && savedSession.cursor>=0 && savedSession.cursor<CFG.practice_trials.length);
}
async function init() {
  try {
    const responses=await Promise.all([fetch('config.json'),fetch('palettes.json')]);
    if(responses.some(r=>!r.ok))throw Error('設定ファイルを読み込めませんでした。');
    [CFG,PALETTES]=await Promise.all(responses.map(r=>r.json()));validateConfig(CFG,PALETTES);
    if(new URLSearchParams(location.search).get('preview')==='consent') {
      showConsentScreen();
      app.insertAdjacentHTML('afterbegin','<p class="preview-notice" role="status">説明画面の確認用です。実験は開始できません。保存済みの記録は変更しません。</p>');
      $('consentBtn').disabled=true;$('consentBtn').onclick=null;
      return;
    }
    let saved;try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch(_){storageAvailable=false;}
    if(!saved){let receipt;try{receipt=JSON.parse(sessionStorage.getItem('color-sequence-receipt')||'null');}catch(_){}if(receipt&&/^DONE-[A-F0-9]{16}$/.test(receipt.code||'')){session={participant:receipt.participant,screening:{crowdworks_username:receipt.crowdworks_username||''},phase:'complete'};showThankYouScreen(receipt.code);return;}}
    if(saved?.session){
      if(saved.session.program_version!==CFG.version){session=saved.session;pendingPayload=saved.pendingPayload;app.innerHTML='<div class="screen"><h1>以前の実施記録が残っています</h1><p>担当者へご連絡ください。</p><button id="backupBtn">控えを保存する</button></div>';$('backupBtn').onclick=downloadJSON;return;}
      return showRecovery(saved);
    }
    showConsentScreen();
  }catch(err){app.innerHTML='<div class="screen"><h1>実験を開始できませんでした</h1><p>'+esc(err.message)+'</p><p>画面を閉じて担当者へご連絡ください。</p></div>';}
}
init();
window.addEventListener('online',()=>{if(session?.phase==='submitting'&&pendingPayload&&!submitting)submitPayload();});
