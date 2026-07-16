import { Home, Plus, Settings } from 'lucide-react';
import { NavLink } from 'react-router-dom';

// Spec §4: persistent bar fixed to the bottom — Home left, + middle, gear right.
export function BottomNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `bottom-nav__link${isActive ? ' bottom-nav__link--active' : ''}`;

  return (
    <nav className="bottom-nav" aria-label="Main">
      <NavLink to="/" className={linkClass} aria-label="Home" end>
        <Home size={26} strokeWidth={2.4} />
      </NavLink>
      <NavLink to="/add" className={linkClass} aria-label="Add">
        <span className="bottom-nav__plus">
          <Plus size={30} strokeWidth={2.8} />
        </span>
      </NavLink>
      <NavLink to="/account" className={linkClass} aria-label="Account" end>
        <Settings size={26} strokeWidth={2.4} />
      </NavLink>
    </nav>
  );
}
