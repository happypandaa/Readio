export default function ViewToggle({ value, onChange }) {
  return <div className="viewseg" role="group" aria-label="显示方式">
    <button aria-pressed={value === 'full'} onClick={() => onChange('full')}>展开</button>
    <button aria-pressed={value === 'compact'} onClick={() => onChange('compact')}>紧凑</button>
  </div>;
}
