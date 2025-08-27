import type { Unzipped } from "fflate";

const LIFE_SPAN = 60_000;

export function ZipFiles(): Record<string, Unzipped> {
	return new Proxy<Record<string, [NodeJS.Timeout, Unzipped]>>(
		{},
		{
			get(target, p, receiver) {
				const value: [NodeJS.Timeout, Unzipped] | undefined = Reflect.get(
					target,
					p,
					receiver,
				);
				if (value) {
					clearTimeout(value[0]);
					value[0] = setTimeout(() => {
						Reflect.deleteProperty(target, p);
					}, LIFE_SPAN);
					return value[1];
				}

				return value;
			},
			set(target, p, value, receiver) {
				return Reflect.set(
					target,
					p,
					[
						setTimeout(() => {
							Reflect.deleteProperty(target, p);
						}, LIFE_SPAN),
						value,
					],
					receiver,
				);
			},
			deleteProperty(target, p) {
				return Reflect.deleteProperty(target, p);
			},
		},
		// biome-ignore lint/suspicious/noExplicitAny: ignore
	) as any;
}
