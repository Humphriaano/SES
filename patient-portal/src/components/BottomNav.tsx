import { NavLink } from 'react-router-dom';
import { Home, LineChart, HeartPulse, CalendarCheck, Mail, Settings } from 'lucide-react';

const ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/trends', label: 'Trends', icon: LineChart },
  { to: '/conditions', label: 'Conditions', icon: HeartPulse },
  { to: '/appointments', label: 'Visits', icon: CalendarCheck },
  { to: '/check-ins', label: 'Check-ins', icon: Mail },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon size={19} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
