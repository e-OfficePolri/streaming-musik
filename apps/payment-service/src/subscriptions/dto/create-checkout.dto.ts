import { IsIn } from 'class-validator';
import { PLANS } from '../plans.config';

export class CreateCheckoutDto {
  @IsIn(Object.keys(PLANS))
  planType: string;
}
