import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth, type Profile } from '../lib/auth';
import { createBill, fetchPeople } from '../lib/data';
import { formatCents, splitCentsEvenly } from '../lib/money';

// Spec §7.1 manual entry: item, people, integer-only amount, split evenly or
// full price, an "Include yourself" toggle that only appears for even splits,
// and a Confirm button. (The "Scan receipt" flow from §7.2 is deferred — it
// needs a paid OCR API; the schema and this form are built so it can slot in.)
export function AddBillPage() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [people, setPeople] = useState<Profile[] | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [splitType, setSplitType] = useState<'even' | 'full_price'>('even');
  const [includeSelf, setIncludeSelf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchPeople(session.user.id)
      .then((result) => {
        if (!cancelled) setPeople(result);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Integer-only amount (spec: "only allows integers"): the input is text
  // with a digits-only regex gate, so decimals and letters never even enter
  // component state — there's nothing to validate later.
  const handleAmountChange = (raw: string) => {
    if (/^\d*$/.test(raw)) setAmount(raw);
  };

  const totalCents = amount === '' ? 0 : Number(amount) * 100;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Live preview of what each person will owe, using the exact same split
  // function that computes the saved shares — so the preview can't lie.
  const preview = useMemo(() => {
    if (totalCents <= 0 || selectedIds.length === 0) return null;
    if (splitType === 'full_price') {
      return `Each selected person owes ${formatCents(totalCents)}`;
    }
    const heads = selectedIds.length + (includeSelf ? 1 : 0);
    const parts = splitCentsEvenly(totalCents, heads);
    const shares = includeSelf ? parts.slice(1) : parts;
    const min = Math.min(...shares);
    const max = Math.max(...shares);
    const range = min === max ? formatCents(min) : `${formatCents(min)}–${formatCents(max)}`;
    return `Split ${heads} ways${includeSelf ? ' (incl. you)' : ''} → ${range} each`;
  }, [totalCents, selectedIds.length, splitType, includeSelf]);

  const canConfirm =
    description.trim().length > 0 && totalCents > 0 && selectedIds.length > 0;

  const handleConfirm = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError(null);
    const failure = await createBill({
      description,
      totalCents,
      participantIds: selectedIds,
      splitType,
      includeSelf: splitType === 'even' && includeSelf,
    });
    setBusy(false);
    if (failure) {
      setError(failure);
    } else {
      // Balances on Home/Detail recompute from the new bill on next load —
      // the "balance update rule" (§7.1) falls out of derived balances.
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="page">
      <h1 className="page__title">Add Bill</h1>

      {people && people.length === 0 && (
        <p className="empty">
          You need people first. <Link to="/add/person">Add a person</Link>, then
          come back.
        </p>
      )}

      {(!people || people.length > 0) && (
        <div className="stack">
          <input
            className="field"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What was it? (e.g. Pizza night)"
            aria-label="Item"
          />

          <p className="field-label">Who's involved?</p>
          <div className="chip-row">
            {(people ?? []).map((person) => (
              <button
                key={person.id}
                type="button"
                className={`chip${selectedIds.includes(person.id) ? ' chip--selected' : ''}`}
                onClick={() => toggleSelected(person.id)}>
                {person.username}
              </button>
            ))}
            {!people && <span className="muted">Loading people…</span>}
          </div>

          <p className="field-label">How much did you pay?</p>
          <input
            className="field"
            value={amount}
            onChange={(event) => handleAmountChange(event.target.value)}
            placeholder="Whole dollars, e.g. 42"
            inputMode="numeric"
            aria-label="Amount in whole dollars"
          />

          <p className="field-label">How should it split?</p>
          <div className="chip-row">
            <button
              type="button"
              className={`chip${splitType === 'even' ? ' chip--selected' : ''}`}
              onClick={() => setSplitType('even')}>
              Split evenly
            </button>
            <button
              type="button"
              className={`chip${splitType === 'full_price' ? ' chip--selected' : ''}`}
              onClick={() => setSplitType('full_price')}>
              Full price
            </button>
            {splitType === 'even' && (
              <button
                type="button"
                className={`chip${includeSelf ? ' chip--selected' : ''}`}
                onClick={() => setIncludeSelf((value) => !value)}>
                Include yourself
              </button>
            )}
          </div>

          {preview && <p className="form-preview">{preview}</p>}
          {error && <p className="error-text">{error}</p>}

          <button
            type="button"
            className="btn btn--primary btn--full"
            disabled={!canConfirm || busy}
            onClick={handleConfirm}>
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}
