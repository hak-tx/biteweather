declare module 'suncalc3' {
  interface MoonTimes {
    rise?: Date;
    set?: Date;
    transit?: Date;
    alwaysUp?: boolean;
    alwaysDown?: boolean;
  }

  interface MoonPosition {
    azimuth: number;
    altitude: number;
    distance: number;
    parallacticAngle: number;
  }

  interface MoonIllumination {
    fraction: number;
    phase: number;
    angle: number;
  }

  export function getMoonTimes(date: Date, lat: number, lng: number, inUTC?: boolean): MoonTimes;
  export function getMoonPosition(date: Date, lat: number, lng: number): MoonPosition;
  export function getMoonIllumination(date: Date): MoonIllumination;
}
