import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useStore } from '../state/store';
import { useActiveRoute, useBarrierCheck, useProfile, useTerrain } from '../state/derived';
import { classify } from '../lib/analysis/terrain';
import { subgoals } from '../lib/subgoals';

echarts.use([LineChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent, CanvasRenderer]);

export default function ElevationProfile({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts>();
  const route = useActiveRoute();
  const { profile, stats, loading, progress, error } = useProfile(route);
  const check = useBarrierCheck(route);
  const terrain = useTerrain(route);
  const focusOn = useStore((s) => s.focusOn);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const data = profile.map((p) => [+(p.d / 1000).toFixed(3), p.z == null ? null : Math.round(p.z)]);
    // stigning per segment (for pulk-vurdering)
    const steepAreas: [{ xAxis: number; itemStyle?: object; name?: string }, { xAxis: number }][] = [];
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i];
      if (a.z == null || b.z == null) continue;
      const g = Math.abs(b.z - a.z) / Math.max(1, b.d - a.d);
      if (g > 0.15) steepAreas.push([{ xAxis: a.d / 1000, itemStyle: { color: g > 0.25 ? 'rgba(239,68,68,0.35)' : 'rgba(249,115,22,0.25)' }, name: g > 0.25 ? 'svært bratt for pulk' : 'tungt med pulk' }, { xAxis: b.d / 1000 }]);
    }
    const crossAreas = check.crossings.map((x) => [{ xAxis: x.fromD / 1000, itemStyle: { color: 'rgba(255,0,64,0.45)' }, name: `Vann: ${x.barrier.name}` }, { xAxis: x.toD / 1000 }]);
    const terrainAreas = (terrain?.samples ?? [])
      .map((t) => ({ t, c: classify(t) }))
      .filter((x) => x.c.cls === 'bratt' || x.c.cls === 'nær-bratt')
      .map(({ t, c }) => [{ xAxis: t.d / 1000 - 0.25, itemStyle: { color: c.cls === 'bratt' ? 'rgba(168,85,247,0.45)' : 'rgba(168,85,247,0.2)' }, name: c.cls === 'bratt' ? 'skredterreng?' : '' }, { xAxis: t.d / 1000 + 0.25 }]);
    const sg = subgoals(route);
    c.setOption(
      {
        backgroundColor: 'transparent',
        grid: { left: 46, right: 14, top: 18, bottom: compact ? 26 : 50 },
        tooltip: {
          trigger: 'axis',
          formatter: (ps: { data: [number, number | null]; dataIndex: number }[]) => {
            const p = ps[0];
            const pp = profile[p.dataIndex];
            return `${p.data[0].toFixed(1)} km · <b>${p.data[1] ?? '–'} moh</b><br/>Kilde: ${pp?.src}<br/><i>Klikk for å vise i kartet</i>`;
          },
        },
        xAxis: { type: 'value', name: 'km', min: 0, max: Math.ceil(stats.total / 1000), axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
        yAxis: { type: 'value', scale: true, name: 'moh', axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#1e293b' } } },
        dataZoom: compact ? [] : [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, borderColor: '#334155', textStyle: { color: '#94a3b8' } }],
        series: [
          {
            type: 'line',
            data,
            showSymbol: false,
            connectNulls: false,
            lineStyle: { color: '#38bdf8', width: 2 },
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(56,189,248,0.35)' }, { offset: 1, color: 'rgba(56,189,248,0.02)' }]) },
            markArea: { silent: true, label: { show: false }, data: [...steepAreas, ...crossAreas, ...terrainAreas] },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#64748b', type: 'dashed' },
              label: { color: '#cbd5e1', fontSize: 10, formatter: (p: { name: string }) => p.name },
              data: sg.slice(1, -1).map((x) => ({ xAxis: x.d / 1000, name: `${x.idx}` })),
            },
          },
        ],
      },
      true,
    );
    c.off('click');
    c.getZr().off('click');
    c.getZr().on('click', (ev: { offsetX: number; offsetY: number }) => {
      const pt = c.convertFromPixel({ seriesIndex: 0 }, [ev.offsetX, ev.offsetY]) as number[];
      if (!pt) return;
      const km = pt[0];
      const p = profile.reduce((best, x) => (Math.abs(x.d / 1000 - km) < Math.abs(best.d / 1000 - km) ? x : best), profile[0]);
      if (p) focusOn(p.lat, p.lon, 14);
    });
  }, [profile, check.crossings, terrain, stats.total, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="profile">
      <div className="profile-head">
        <span>
          Høydeprofil · kilde: <b>{stats.src === 'DTM' ? 'Kartverket DTM' : stats.src === 'GPX' ? 'GPX (Garmin) – DTM ikke lastet' : stats.src}</b>
          {loading && ` · henter DTM ${Math.round(progress * 100)} %`}
          {error && <span className="err"> · DTM-feil: {error}</span>}
        </span>
        <span className="legend">
          <i style={{ background: 'rgba(249,115,22,.5)' }} /> &gt;15 % <i style={{ background: 'rgba(239,68,68,.6)' }} /> &gt;25 % <i style={{ background: 'rgba(255,0,64,.7)' }} /> vann <i style={{ background: 'rgba(168,85,247,.6)' }} /> ≥30° nær
        </span>
      </div>
      <div ref={ref} className="profile-chart" />
    </div>
  );
}
