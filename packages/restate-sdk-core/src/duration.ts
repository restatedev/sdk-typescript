/*
 * Copyright (c) 2023-2025 - Restate Software, Inc., Restate GmbH
 *
 * This file is part of the Restate SDK for Node.js/TypeScript,
 * which is released under the MIT license.
 *
 * You can find a copy of the license in file LICENSE in the root
 * directory of this repository or package, or at
 * https://github.com/restatedev/sdk-typescript/blob/main/LICENSE
 */

/**
 * Duration type. Note that fields are additive.
 */
export type Duration = {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
};

export function millisOrDurationToMillis(duration: number | Duration): number {
  if (typeof duration === "number") {
    return duration;
  } else {
    return durationToMillis(duration);
  }
}

export function durationToMillis(duration: Duration): number {
  return (
    (duration.milliseconds ?? 0) +
    1000 * (duration.seconds ?? 0) +
    1000 * 60 * (duration.minutes ?? 0) +
    1000 * 60 * 60 * (duration.hours ?? 0) +
    1000 * 60 * 60 * 24 * (duration.days ?? 0)
  );
}
