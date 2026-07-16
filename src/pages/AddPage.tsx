import { ReceiptText, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

// Spec §7: two big stacked buttons, each leading to its own page.
export function AddPage() {
  return (
    <div className="page">
      <h1 className="page__title">Add</h1>
      <div className="stack stack--roomy">
        <Link to="/add/bill" className="add-choice">
          <ReceiptText size={28} strokeWidth={2.2} />
          <span>Add Bill</span>
        </Link>
        <Link to="/add/person" className="add-choice">
          <UserPlus size={28} strokeWidth={2.2} />
          <span>Add Person</span>
        </Link>
      </div>
    </div>
  );
}
