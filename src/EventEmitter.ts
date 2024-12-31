type EventParameters<F extends ((...args: any) => any)> =
	Parameters<F> extends [...infer S, any] ? S : never;

export class EventEmitter<E extends Record<string, any>> {
	private _listeners = new Map<keyof E, E[keyof E]>();

	on<K extends keyof E>(event: K, handler: E[K]) {
		this._listeners.set(event, handler);
	}

	trigger<K extends keyof E>(event: K, ...args: EventParameters<E[K]>) {
		if (this._listeners.has(event)) {
			this._listeners.get(event)!.call(this, ...args, this);
		}
	}
}
