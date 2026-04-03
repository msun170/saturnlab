import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { getKernelMemory } from '../../lib/ipc';
import { formatBytes } from '../../types/memory';

export default function MemoryBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);

  const [kernelRss, setKernelRss] = useState(0);
  const [totalMem, setTotalMem] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!tab?.kernelId) {
      setKernelRss(0);
      setTotalMem(0);
      return;
    }

    const poll = () => {
      const currentTab = useAppStore.getState().tabs.find((t) => t.id === activeTabId);
      if (!currentTab?.kernelId) return;

      getKernelMemory(currentTab.kernelId).then((info) => {
        setKernelRss(info.kernel_rss);
        setTotalMem(info.total_memory);
      }).catch(() => {});
    };

    poll();
    intervalRef.current = setInterval(poll, 3000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tab?.kernelId, activeTabId]);

  if (!tab?.kernelId || totalMem === 0) return null;

  const usedPercent = totalMem > 0 ? (kernelRss / totalMem) * 100 : 0;

  let barColor = '#4caf50'; // green
  if (usedPercent > 5) barColor = '#ff9800'; // yellow (kernel using >5% of total RAM is notable)
  if (usedPercent > 15) barColor = '#f44336'; // red

  return (
    <div className="memory-bar" title={`Kernel: ${formatBytes(kernelRss)} / System: ${formatBytes(totalMem)}`}>
      <div className="memory-bar-track">
        <div
          className="memory-bar-fill"
          style={{ width: `${Math.min(usedPercent * 10, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      <span className="memory-bar-text">{formatBytes(kernelRss)}</span>
    </div>
  );
}
