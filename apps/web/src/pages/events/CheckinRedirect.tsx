import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../../lib/api';
import { useWpath } from '../../stores/session';
import { Spinner } from '../../components/ui';

/** A phone camera scanning a guest pass opens /c/<token>: resolve its event and open the check-in screen. */
export default function CheckinRedirect() {
  const { token } = useParams();
  const wp = useWpath();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post(wp('/checkins/lookup')!, { code: token ?? '' })
      .then((r) => navigate(`/events/${r.guest.event_id}/checkin?code=${encodeURIComponent(token ?? '')}`, { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Invalid pass'));
  }, [token, wp, navigate]);
  return (
    <div className="h-full grid place-items-center p-6 text-center">
      {error ? <div><p className="font-medium">{error}</p><p className="text-[13px] text-muted mt-1">This pass may belong to another workspace.</p><Link to="/events" className="text-brand-600 text-[13px] mt-3 inline-block">Go to events</Link></div> : <Spinner className="size-5" />}
    </div>
  );
}
