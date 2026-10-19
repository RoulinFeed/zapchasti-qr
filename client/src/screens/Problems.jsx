import { useStore, dismissRejected } from '../store.js';
import { MOVE_TYPES } from '../../../shared/state.js';
import { Section, fmtDate, unitLabel } from '../ui.jsx';

// Операции, которые сервер не принял (например, не хватило прав). На учёт они не повлияли.
export default function Problems() {
  const { rejected, state } = useStore();
  return (
    <Section title="Не принятые сервером операции">
      {rejected.length === 0 && <p className="muted">Ошибок нет.</p>}
      <ul className="list">
        {rejected.map((op) => (
          <li key={op.id} className="line">
            <span className="grow">
              <b>
                {op.kind === 'move' ? `${MOVE_TYPES[op.payload.type]}: ${unitLabel(state, op.payload.unit)}` : op.kind}
              </b>
              <div className="muted small">
                {fmtDate(op.createdAt)} · {op.error}
              </div>
            </span>
            <button className="btn small" onClick={() => dismissRejected(op.id)}>
              Понятно
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
