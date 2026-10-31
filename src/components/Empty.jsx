export default function Empty({ title, description, onAdd }) {
  return <div className="empty">
    <h2>{title}</h2>
    <p>{description}</p>
    {onAdd && <button className="btn primary" onClick={onAdd}>添加文章</button>}
  </div>;
}
