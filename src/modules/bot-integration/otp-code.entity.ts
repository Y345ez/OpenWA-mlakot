import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('otp_codes')
export class OtpCode {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  @Index()
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 4 })
  code!: string;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
