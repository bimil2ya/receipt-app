import { APP_VERSION } from '../../utils/version';

export default function SettingsVersionFooter() {
  return (
    <p className="text-center text-xs text-slate-500 font-bold pt-2">
      {APP_VERSION}
    </p>
  );
}
