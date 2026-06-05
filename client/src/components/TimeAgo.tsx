import { useState, useEffect } from "react";

export default function TimeAgo({ date }: { date: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 2) return <>just now</>;
  if (seconds < 60) return <>{seconds}s ago</>;
  return <>{Math.floor(seconds / 60)}m ago</>;
}
