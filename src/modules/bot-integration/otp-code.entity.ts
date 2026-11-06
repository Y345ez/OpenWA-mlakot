import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { nativeDateTimeColumnType } from '../../common/utils/column-types';

@Entity('otp_codes')
export class OtpCode {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  @Index('IDX_otp_codes_phoneNumber')
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 4 })
  code!: string;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: nativeDateTimeColumnType() })
  expiresAt!: Date;

  @CreateDateColumn({ type: nativeDateTimeColumnType() })
  createdAt!: Date;
}
