import { useEffect, useRef } from 'react';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = new VisualizerEngine(container);

    return () => {
      engine.destroy();
    };
  }, []);

  return (
    <div className="canvas-stage">
      <div ref={containerRef} className="canvas-container" />
    </div>
  );
}

export default App;
