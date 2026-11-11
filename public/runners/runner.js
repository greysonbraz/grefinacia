/* Grefinacia — verificação de novos proventos em segundo plano (Capacitor Background Runner).
 * Roda a cada ~1 h (o Android decide o horário exato; economia de bateria/Samsung pode atrasar).
 * Só avisa de proventos que o app ainda não conhecia e nunca faz operações financeiras. */

function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function dateOnly(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined; }
function brDate(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function brl(n) { return 'R$ ' + n.toFixed(2).replace('.', ','); }

function labelToKind(label, type) {
  var l = String(label || '').toUpperCase();
  if (l.indexOf('JCP') >= 0 || l.indexOf('JUROS') >= 0) return 'jcp';
  if (l.indexOf('AMORT') >= 0 || l.indexOf('RESTITUI') >= 0) return 'amortizacao';
  if (l.indexOf('RENDIMENTO') >= 0) return 'rendimento';
  if (l.indexOf('DIVIDENDO') >= 0) return type === 'fii' ? 'rendimento' : 'dividendo';
  return type === 'fii' ? 'rendimento' : 'outro';
}
function makeKey(ticker, kind, dataCom, rate) { return [ticker.toUpperCase(), kind, dataCom || '', rate.toFixed(8)].join('|'); }

function dataComFromEx(ex) {
  var p = ex.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2], 12);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return isoOf(d);
}

function hashId(key) {
  var h = 5381;
  for (var i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2147483646) + 1;
}

function parseBrapi(json, asset) {
  var raw = [];
  var r0 = json && json.results && json.results[0];
  if (r0 && r0.data && Array.isArray(r0.data.cashDividends)) raw = raw.concat(r0.data.cashDividends);
  if (r0 && r0.dividendsData && Array.isArray(r0.dividendsData.cashDividends)) raw = raw.concat(r0.dividendsData.cashDividends);
  if (json && Array.isArray(json.dividends)) raw = raw.concat(json.dividends);
  var out = [];
  raw.forEach(function (d) {
    var rate = Number(d.rate != null ? d.rate : d.value);
    if (!isFinite(rate) || rate <= 0) return;
    var kind = labelToKind(d.label || d.type, asset.type);
    var dataCom = dateOnly(d.lastDatePrior);
    out.push({ kind: kind, rate: rate, dataCom: dataCom, paymentDate: dateOnly(d.paymentDate), key: makeKey(asset.ticker, kind, dataCom, rate) });
  });
  return out;
}

function parseYahoo(json, asset) {
  var evs = json && json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].events && json.chart.result[0].events.dividends;
  var out = [];
  if (!evs) return out;
  Object.keys(evs).forEach(function (k) {
    var e = evs[k];
    var rate = Number(e.amount);
    if (!isFinite(rate) || rate <= 0 || !e.date) return;
    var ex = isoOf(new Date(e.date * 1000));
    var kind = asset.type === 'fii' ? 'rendimento' : 'dividendo';
    var dataCom = dataComFromEx(ex);
    out.push({ kind: kind, rate: rate, dataCom: dataCom, paymentDate: undefined, key: makeKey(asset.ticker, kind, dataCom, rate) });
  });
  return out;
}

async function fetchEvents(asset, cfg) {
  if (cfg.provider === 'yahoo') {
    var ry = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + asset.ticker + '.SA?range=2y&interval=1d&events=div');
    return parseYahoo(await ry.json(), asset);
  }
  var path = asset.type === 'fii' ? '/api/v2/fii/dividends?symbols=' : '/api/v2/stocks/dividends?symbols=';
  var headers = cfg.token ? { Authorization: 'Bearer ' + cfg.token } : {};
  var r = await fetch('https://brapi.dev' + path + asset.ticker, { method: 'GET', headers: headers });
  if (r.status !== 200) return [];
  return parseBrapi(await r.json(), asset);
}

async function check() {
  var stored = await CapacitorKV.get('config');
  if (!stored || !stored.value) return;
  var cfg = JSON.parse(stored.value);
  if (!cfg.enabled) return;
  var known = {};
  (cfg.knownKeys || []).forEach(function (k) { known[k] = true; });
  var firstRun = (cfg.knownKeys || []).length === 0;
  var today = isoOf(new Date());
  var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  var limitCom = isoOf(weekAgo);
  var notes = [];
  for (var i = 0; i < cfg.assets.length; i++) {
    var asset = cfg.assets[i];
    var events = [];
    try { events = await fetchEvents(asset, cfg); } catch (e) { continue; }
    events.forEach(function (ev) {
      if (known[ev.key]) return;
      known[ev.key] = true;
      var recent = ev.paymentDate ? ev.paymentDate >= today : (ev.dataCom && ev.dataCom >= limitCom);
      if (firstRun || !recent) return;
      var what = ev.kind === 'jcp' ? 'JCP' : ev.kind === 'rendimento' ? 'rendimento' : 'dividendo';
      var total = asset.qty ? ' (≈ ' + brl(ev.rate * asset.qty) + ' para suas ' + asset.qty + ')' : '';
      var when = ev.paymentDate ? ' Pagamento em ' + brDate(ev.paymentDate) + '.' : ' Data de pagamento ainda não divulgada.';
      notes.push({ id: hashId('runner:' + ev.key), title: asset.ticker + ' anunciou ' + what, body: brl(ev.rate) + ' por ' + (asset.type === 'fii' ? 'cota' : 'ação') + total + '.' + when, scheduleAt: new Date(Date.now() + 3000), channelId: 'dividendos' });
    });
  }
  cfg.knownKeys = Object.keys(known);
  await CapacitorKV.set('config', JSON.stringify(cfg));
  if (notes.length > 0) CapacitorNotifications.schedule(notes.slice(0, 10));
}

addEventListener('saveConfig', function (resolve, reject, args) {
  try {
    CapacitorKV.set('config', args.config);
    resolve();
  } catch (e) { reject(e); }
});

addEventListener('checkDividends', function (resolve, reject) {
  check().then(function () { resolve(); }).catch(function (e) { reject(e); });
});
