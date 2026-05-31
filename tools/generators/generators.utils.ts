export namespace GeneratorsUtils {
    export const capitalcase = (value: string, joiner: string = '') => {
        return value
            .split('-')
            .map((word) => word.charAt(0).toLocaleUpperCase() + word.substring(1))
            .join(joiner);
    };

    export const camelcase = (value: string) => {
        return value
            .split('-')
            .map((word, index) =>
                index ? word.charAt(0).toLocaleUpperCase() + word.substring(1) : word,
            )
            .join('');
    };

    export const uppercase = (value: string) => {
        return value.replace(/[-]/gm, '_').toLocaleUpperCase();
    };
}
