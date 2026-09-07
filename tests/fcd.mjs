#!/usr/bin/env node
/**
 * Unit tests for the floating-car-data logic.
 *
 * These run in Node with no browser: parsing, percentiles and corridor projection
 * are pure functions precisely so the arithmetic can be checked without a scene.
 * The Italian-export case is here because a semicolon file with decimal commas is
 * what the data actually arrives as, and a parser that mishandles it produces wrong
 * numbers rather than an error.
 *
 *   node tests/fcd.mjs
 */

import {
  binProfile,
  guessSpeedUnit,
  parseDelimited,
  parseGeoJson,
  percentile,
  projectToCorridor,
  sampleEvenly,
  sniffFormat,
  summarise,
} from "../app/src/fcd.js";

let pass=0, fail=0;
const t=(name,cond,detail="")=>{ if(cond){pass++;console.log("  ok   "+name);} else {fail++;console.log("  FAIL "+name+(detail?" — "+detail:""));} };

// Percentiles against a known series.
const s=[1,2,3,4,5,6,7,8,9,10];
t("p50 of 1..10 is 5.5", percentile(s,50)===5.5, String(percentile(s,50)));
t("p85 of 1..10 is 8.65", Math.abs(percentile(s,85)-8.65)<1e-9, String(percentile(s,85)));
t("p0 and p100 are the extremes", percentile(s,0)===1 && percentile(s,100)===10);

// Anglo CSV.
const anglo=`id,timestamp,lat,lon,speed
a1,2026-01-05T08:00:00Z,41.8944,12.4846,48.2
a1,2026-01-05T08:00:05Z,41.8940,12.4852,51.7
a2,2026-01-05T08:01:00Z,41.8935,12.4860,44.0`;
const A=parseDelimited(anglo);
t("comma CSV sniffed", A.format.delimiter==="," && A.format.decimalComma===false);
t("columns detected", A.mapping.latitude===2 && A.mapping.longitude===3 && A.mapping.speed===4);
t("rows parsed", A.points.length===3, String(A.points.length));
t("speed read", A.points[1].speed===51.7);

// Italian export: semicolons and decimal commas.
const ital=`id;data_ora;latitudine;longitudine;velocita
v1;05/01/2026 08:00:00;41,8944;12,4846;48,2
v1;05/01/2026 08:00:05;41,8940;12,4852;51,7`;
const I=parseDelimited(ital);
t("semicolon sniffed", I.format.delimiter===";", I.format.delimiter);
t("decimal comma detected", I.format.decimalComma===true);
t("italian headers detected", I.mapping.latitude===2 && I.mapping.speed===4);
t("decimal comma parsed correctly", Math.abs(I.points[0].lat-41.8944)<1e-9, String(I.points[0].lat));
t("italian speed parsed", Math.abs(I.points[1].speed-51.7)<1e-9, String(I.points[1].speed));

// Projected CRS must be refused loudly, not plotted.
const proj=`lat,lon,speed
4640000,290000,50
4640010,290010,52`;
const P=parseDelimited(proj);
t("projected coords rejected", P.points.length===0, String(P.points.length));
t("projected warning names EPSG", P.warnings.some(w=>w.includes("EPSG:4326")), JSON.stringify(P.warnings));

// Missing speed column is a warning, not a failure.
const nospeed=`lat,lon\n41.89,12.48\n41.88,12.49`;
const N=parseDelimited(nospeed);
t("parses without a speed column", N.points.length===2);
t("warns about missing speed", N.warnings.some(w=>w.includes("No speed column")));

// Unit guessing.
t("km/h guessed", guessSpeedUnit([30,45,52,60,48]).unit==="kmh");
t("m/s guessed", guessSpeedUnit([8,12,14,15,11]).unit==="ms");

// Corridor projection: fake a straight axis where station=x metres, offset=y metres.
const project=(lon,lat)=>({station:(lon-12)*100000, offset:(lat-41)*100000});
const pts=[
  {lon:12.001,lat:41.00000,speed:50},   // station 100, offset 0
  {lon:12.002,lat:41.00005,speed:60},   // station 200, offset 5
  {lon:12.003,lat:41.00050,speed:70},   // station 300, offset 50 -> outside
  {lon:12.009,lat:41.00000,speed:80},   // station 900 -> beyond 'to'
];
const inside=projectToCorridor(pts, project, {halfWidth:22, from:0, to:500});
t("points outside the corridor are dropped", inside.length===2, String(inside.length));
t("chainage attached", Math.abs(inside[0].station-100)<1e-6);

// Profile binning.
const many=[];
for(let i=0;i<300;i++) many.push({station:i, speed:40+(i%10), offset:0});
const bins=binProfile(many,{binSize:50, from:0, to:300});
t("bin count follows the length", bins.length===6, String(bins.length));
t("bins carry percentiles", bins[0].v85>bins[0].v15 && bins[0].n===50);
t("sparse bins are flagged", binProfile([{station:5,speed:50}],{binSize:50,from:0,to:50})[0].sparse===true);

// Summary stats.
const sum=summarise([40,45,50,55,60,65,70],50);
t("v85 interpolates over 7 values", Math.abs(sum.v85-65.5)<1e-9, String(sum.v85));
t("share over limit", Math.abs(sum.overLimit-4/7)<1e-9, String(sum.overLimit));

// GeoJSON.
const gj=parseGeoJson(JSON.stringify({type:"FeatureCollection",features:[
  {type:"Feature",geometry:{type:"Point",coordinates:[12.48,41.89]},properties:{speed:44}},
  {type:"Feature",geometry:{type:"LineString",coordinates:[[12.49,41.88],[12.50,41.87]]},properties:{velocita:38}},
]}));
t("geojson points and lines read", gj.points.length===3, String(gj.points.length));
t("geojson speed property found", gj.points[0].speed===44 && gj.points[1].speed===38);

// Sampling stays unbiased across the range.
const big=Array.from({length:100000},(_,i)=>({station:i}));
const {sample,sampled}=sampleEvenly(big,1000);
t("large sets are capped", sampled && sample.length===1000);
t("sampling spans the whole range", sample[0].station===0 && sample.at(-1).station>99000);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
