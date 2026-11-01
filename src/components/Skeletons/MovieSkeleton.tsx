import React from 'react';

const MovieSkeleton: React.FC = () => {
  return (
    <div className="movie-skeleton">
      {/* Title */}
      <div className="skeleton-item skeleton-title" />

      {/* Badges */}
      <div className="skeleton-badges-row">
        <div className="skeleton-item skeleton-badge" />
        <div className="skeleton-item skeleton-badge" />
        <div className="skeleton-item skeleton-badge" />
        <div className="skeleton-item skeleton-badge" />
      </div>

      {/* Genres */}
      <div className="skeleton-item skeleton-genres" />

      {/* Synopsis */}
      <div className="skeleton-synopsis">
        <div className="skeleton-item skeleton-text" />
        <div className="skeleton-item skeleton-text" />
        <div className="skeleton-item skeleton-text" />
        <div className="skeleton-item skeleton-text short" />
      </div>

      {/* Casting */}
      <div className="skeleton-item skeleton-casting" />

      {/* Action buttons */}
      <div className="skeleton-buttons">
        <div className="skeleton-item skeleton-button" />
        <div className="skeleton-item skeleton-button-circle" />
        <div className="skeleton-item skeleton-source-btn" />
      </div>

      {/* Trailer */}
      <div className="skeleton-item skeleton-trailer" />
    </div>
  );
};

export default MovieSkeleton;
