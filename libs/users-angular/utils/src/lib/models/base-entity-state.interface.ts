import { EntityState } from '@ngrx/entity';

export interface BaseEntityState<T> extends EntityState<T> {
  loading: boolean;
  loaded: boolean;
  error: string | null;
}
