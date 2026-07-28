import { Skeleton } from "../ui/Skeleton";

export function ProfileCardSkeleton() {
  return (
    <div className="profile-card profile-card--skeleton" aria-hidden="true">
      <Skeleton className="profile-card__banner" />
      <div className="profile-card__identity">
        <Skeleton className="profile-card__avatar profile-card__avatar-skeleton" />
        <Skeleton width="55%" height="18px" />
      </div>
      <div className="profile-card__body">
        <Skeleton width="75%" height="12px" />
        <div className="profile-card__stats">
          {[0, 1, 2, 3].map((id) => <Skeleton key={id} height="48px" />)}
        </div>
      </div>
    </div>
  );
}
